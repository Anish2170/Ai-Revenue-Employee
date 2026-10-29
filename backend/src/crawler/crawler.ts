/** Bounded prioritized same-origin crawler. All network work is injectable only
 * at the internal service boundary; public routes cannot override SSRF policy. */
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import * as cheerio from 'cheerio';
import { config } from '../config/index.js';
import { safeFetch, UnsafeUrlError, type SafeFetchOptions } from '../security/ssrf.js';
import { extract } from './extract.js';
import { usefulBusinessText } from './contentPolicy.js';
import { normalizeUrl, isCrawlablePath, classifyPage } from './links.js';
import { renderPage, type RenderedPage } from './browserRenderer.js';
import { parseRobots, type RobotsPolicy } from './robots.js';
import type { CrawlEntry, CrawlManifest } from './crawlManifest.js';
import type { CrawledPage } from '../context/types.js';
import { extractActionsFromHtml, type RawDiscoveredAction } from '../business-actions/actionDiscovery.js';
export interface CrawlOptions {
    maxPages?: number;
    concurrency?: number;
    timeoutMs?: number;
    maxDepth?: number;
    maxRequests?: number;
    maxQueued?: number;
    maxRenderedPages?: number;
    maxDurationMs?: number;
    knownUrls?: string[];
    /** Only supplied by the worker from a server-created, validated approval. */
    reviewedSources?: Array<{ url: string; disposition: 'required' | 'owner_excluded' | 'system_excluded' }>;
    signal?: AbortSignal;
    onProgress?: (pages: number, skipped: number, limit: number) => void | Promise<void>;
}
export interface CrawlResult {
    pages: CrawledPage[];
    skipped: string[];
    actions: RawDiscoveredAction[];
    manifest: CrawlManifest;
}
export interface CrawlDependencies {
    fetch?: (url: string, options: SafeFetchOptions) => ReturnType<typeof safeFetch>;
    render?: (url: string, timeoutMs: number, policy?: Parameters<typeof renderPage>[2]) => Promise<RenderedPage>;
    sleep?: (ms: number) => Promise<void>;
}
const bounded = (value: number | undefined, fallback: number, max: number) => Math.min(max, Math.max(1, Math.floor(Number.isFinite(value) ? value! : fallback)));
export function crawlPriority(url: string): number { const path = new URL(url).pathname; return /pricing|plans?|refund|cancel|returns?|polic|terms|hours|contact|faq/i.test(path) ? 100 : /services?|products?|menu|rooms?|collection|booking|appointment/i.test(path) ? 80 : /about|team/i.test(path) ? 50 : /blog|news|tag|archive/i.test(path) ? 10 : 30; }
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export async function crawl(startUrl: string, opts: CrawlOptions = {}, deps: CrawlDependencies = {}): Promise<CrawlResult> {
    const start = normalizeUrl(startUrl);
    if (!start)
        throw Error('Invalid start URL.');
    const origin = new URL(start).origin, maxPages = bounded(opts.maxPages ?? config.crawl.maxPages, 25, 100), maxDepth = bounded(opts.maxDepth, 5, 8), maxRequests = bounded(opts.maxRequests, maxPages * 4 + 130, 500), maxQueued = bounded(opts.maxQueued, 1000, 2000), maxRender = opts.maxRenderedPages === 0 ? 0 : bounded(opts.maxRenderedPages, 3, 8), timeout = bounded(opts.timeoutMs ?? config.crawl.timeoutMs, 12000, 30000);
    const deadline = Date.now() + bounded(opts.maxDurationMs, 120000, 300000), controller = new AbortController(), timer = setTimeout(() => controller.abort(Error('crawl_deadline')), Math.max(1, deadline - Date.now()));
    const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
    const transport = deps.fetch ?? safeFetch, sleep = deps.sleep ?? (async (ms) => { await pause(ms, undefined, { signal }); });
    const pages: CrawledPage[] = [], skipped: string[] = [], actions: RawDiscoveredAction[] = [], entries = new Map<string, CrawlEntry>(), queue: CrawlEntry[] = [], limits = new Set<string>();
    const sitemapVisited = new Set<string>();
    const known = new Set((opts.knownUrls ?? []).map(url => normalizeUrl(url)).filter(Boolean));
    const reviewed = new Map(opts.reviewedSources?.map(entry => [entry.url, entry.disposition]));
    let attempts = 0, network = 0, renders = 0, sitemapCalls = 0, acceptedChars = 0;
    let robots: RobotsPolicy = { allows: () => true, sitemaps: [], delayMs: 0 };
    const add = (raw: string, depth: number) => { const url = normalizeUrl(raw, start); if (!url || new URL(url).origin !== origin)
        return; if (entries.has(url)) {
        const prior = entries.get(url)!;
        prior.depth = Math.min(prior.depth, depth);
        return;
    } if (entries.size >= maxQueued) {
        limits.add('queue_limit');
        return;
    } const entry: CrawlEntry = { url, depth, category: /refund|cancel|return|polic|terms/i.test(url) ? 'policy' : classifyPage(new URL(url).pathname), state: 'pending' }; entries.set(url, entry); if (!isCrawlablePath(url)) {
        entry.state = 'excluded';
        entry.reason = 'outside_html_scope';
        return;
    } if (depth > maxDepth) {
        entry.state = 'excluded';
        entry.reason = 'depth_limit';
        limits.add('depth_limit');
        return;
    } if (!robots.allows(url)) {
        entry.state = 'excluded';
        entry.reason = 'robots_disallow';
        limits.add('source_restricted');
        if (known.has(url))
            limits.add('previous_source_restricted');
        return;
    } if (reviewed.get(url) === 'owner_excluded') {
        entry.state = 'excluded'; entry.reason = 'owner_excluded'; return;
    } queue.push(entry); };
    let hostQueue = Promise.resolve(), lastRequestAt = 0;
    const pace = async () => { if (robots.delayMs) {
        hostQueue = hostQueue.then(async () => { signal.throwIfAborted(); await sleep(Math.max(0, robots.delayMs - (Date.now() - lastRequestAt))); lastRequestAt = Date.now(); });
        await hostQueue;
    }
    else
        lastRequestAt = Date.now(); };
    const request = async (url: string, extra: Partial<SafeFetchOptions> = {}) => {
        signal.throwIfAborted();
        if (network >= maxRequests)
            throw Error('request_budget');
        network++;
        await pace();
        signal.throwIfAborted();
        let first = true;
        const onRequest = async (target: URL) => { if (!normalizeUrl(target.href) || target.origin !== origin || !robots.allows(target.href))
            throw new UnsafeUrlError(); if (first) {
            first = false;
            return;
        } if (network >= maxRequests)
            throw Error('request_budget'); network++; await pace(); };
        const result = await transport(url, { timeoutMs: Math.max(1, Math.min(timeout, deadline - Date.now())), maxBytes: 2 * 1024 * 1024, allowedOrigin: origin, signal, headers: { 'User-Agent': 'AIRevenueEmployee-Crawler/1.0', 'Accept-Encoding': 'identity' }, ...extra, onRequest });
        if (new URL(result.url).origin !== origin || !robots.allows(result.url))
            throw new UnsafeUrlError();
        return result;
    };
    try {
        try {
            const response = await request(origin + '/robots.txt', { maxBytes: 512000 });
            if (response.status === 200)
                robots = parseRobots(response.body.toString('utf8'), origin);
            else if (![404, 410].includes(response.status))
                throw Error('robots_unavailable');
        }
        catch {
            limits.add('robots_unavailable');
        }
        const readSitemap = async (url: string, depth = 0): Promise<void> => {
            if (sitemapVisited.has(url))
                return;
            sitemapVisited.add(url);
            if (sitemapCalls >= 4) {
                limits.add('sitemap_limit');
                return;
            }
            if (depth > 2) {
                limits.add('sitemap_depth');
                return;
            }
            if (!robots.allows(url))
                return;
            sitemapCalls++;
            try {
                const response = await request(url, { maxBytes: 1024 * 1024 });
                if ([404, 410].includes(response.status))
                    return;
                if (response.status !== 200)
                    throw Error('sitemap_unavailable');
                const xml = response.body.toString('utf8');
                if (/<!DOCTYPE|<!ENTITY/iu.test(xml) || !/<(?:urlset|sitemapindex)\b/iu.test(xml))
                    throw Error('sitemap_invalid');
                const $ = cheerio.load(xml, { xmlMode: true });
                if ($('sitemapindex').length) {
                    for (const node of $('sitemap > loc').toArray().slice(0, 5)) {
                        const child = normalizeUrl($(node).text(), url);
                        if (child && new URL(child).origin === origin)
                            await readSitemap(child, depth + 1);
                    }
                }
                else {
                    const nodes = $('url > loc').toArray();
                    if (nodes.length > maxQueued)
                        limits.add('sitemap_url_limit');
                    for (const node of nodes.slice(0, maxQueued))
                        add($(node).text().trim(), 1);
                }
            }
            catch {
                limits.add('sitemap_unavailable');
            }
        };
        if (!limits.has('robots_unavailable')) {
            for (const sitemap of robots.sitemaps.length ? robots.sitemaps : [origin + '/sitemap.xml'])
                await readSitemap(sitemap);
            add(start, 0);
            // Review is a frozen inventory. Seed it so removed links cannot silently disappear.
            for (const source of opts.reviewedSources ?? []) add(source.url, 0);
            for (const url of known)
                if (url)
                    add(url, 0);
            while (queue.length && attempts < maxPages && !signal.aborted && !limits.has('text_budget')) {
                queue.sort((a, b) => (b.url === start ? 1000 : known.has(b.url) ? 900 : reviewed.get(b.url) === 'required' ? 850 : crawlPriority(b.url)) - (a.url === start ? 1000 : known.has(a.url) ? 900 : reviewed.get(a.url) === 'required' ? 850 : crawlPriority(a.url)) || a.depth - b.depth || a.url.localeCompare(b.url));
                const concurrency = robots.delayMs ? 1 : bounded(opts.concurrency ?? config.crawl.concurrency, 4, 4), wave = queue.splice(0, Math.min(concurrency, maxPages - attempts));
                attempts += wave.length;
                const results = await Promise.all(wave.map(async (entry) => {
                    try {
                        let response = await request(entry.url);
                        if ([429, 502, 503, 504].includes(response.status)) {
                            const raw = String(response.headers['retry-after'] ?? '');
                            const delay = /^\d+$/.test(raw) ? Number(raw) * 1000 : raw ? Date.parse(raw) - Date.now() : 500;
                            if (delay > 2000)
                                throw Error('rate_limited');
                            await sleep(Math.max(500, delay || 500));
                            response = await request(entry.url);
                        }
                        entry.httpStatus = response.status;
                        if (response.status === 410) {
                            entry.state = 'gone';
                            entry.reason = 'http_410';
                            return null;
                        }
                        if (response.status < 200 || response.status >= 300) {
                            entry.state = 'failed';
                            entry.reason = `http_${response.status}`;
                            return null;
                        }
                        if (!String(response.headers['content-type'] ?? '').toLowerCase().includes('text/html')) {
                            entry.state = known.has(entry.url) ? 'failed' : 'excluded';
                            entry.reason = 'non_html';
                            return null;
                        }
                        entry.finalUrl = response.url;
                        let html = response.body.toString('utf8'), url = response.url, parsed = extract(html, url);
                        entry.renderer = 'static';
                        if (parsed.needsRendering) {
                            if (renders >= maxRender)
                                throw Error('render_budget');
                            renders++;
                            const rendered = await (deps.render ?? renderPage)(url, Math.max(1, Math.min(timeout, deadline - Date.now())), { signal, origin, fetch: request, allows: target => robots.allows(target) });
                            if (rendered.incomplete)
                                throw Error(rendered.blockedResources?.length ? 'external_or_restricted_resources' : 'dynamic_content_unresolved');
                            if (rendered.status !== null && (rendered.status < 200 || rendered.status >= 300))
                                throw Error('render_http_failure');
                            if (new URL(rendered.url).origin !== origin)
                                throw Error('render_scope');
                            html = rendered.html;
                            url = rendered.url;
                            entry.finalUrl = url;
                            parsed = extract(html, url);
                            entry.renderer = 'js-rendered';
                            if (parsed.needsRendering)
                                throw Error('dynamic_content_unresolved');
                        }
                        for (const link of parsed.links)
                            add(link, entry.depth + 1);
                        if (parsed.canonical) {
                            const normalized = normalizeUrl(parsed.canonical);
                            if (normalized && new URL(normalized).origin === origin) {
                                entry.canonical = normalized;
                                add(normalized, entry.depth);
                            }
                        }
                        if (!usefulBusinessText(parsed.text)) {
                            entry.state = known.has(entry.url) ? 'failed' : 'excluded';
                            entry.reason = parsed.structuredDataBlocks ? 'unverified_structured_data' : 'low_value';
                            return null;
                        }
                        entry.state = 'fetched';
                        entry.contentHash = hash(parsed.text);
                        entry.title = parsed.title;
                        const page: CrawledPage = { url, path: new URL(url).pathname, title: parsed.title || new URL(url).pathname, text: parsed.text, sections: parsed.sections, pageType: classifyPage(new URL(url).pathname), contentHash: entry.contentHash, lastCrawled: new Date().toISOString(), renderer: entry.renderer, httpStatus: response.status, cleaning: parsed.cleaning };
                        return { page, raw: extractActionsFromHtml(html, page, 100) };
                    }
                    catch (error) {
                        entry.state = 'failed';
                        const message = error instanceof Error ? error.message : '';
                        entry.reason = signal.aborted ? 'cancelled_or_deadline' : /^(render_budget|external_or_restricted_resources|dynamic_content_unresolved|render_scope|request_budget)$/.test(message) ? message : error instanceof UnsafeUrlError ? 'unsafe_or_out_of_scope' : /size limit/i.test(message) ? 'response_size_limit' : 'fetch_or_render_failure';
                        return null;
                    }
                }));
                // Deterministic commit order even when requests complete in a different order.
                for (let i = 0; i < results.length; i++) {
                    const result = results[i], entry = wave[i];
                    if (!result) {
                        if (entry.state === 'failed')
                            skipped.push(entry.url);
                        continue;
                    }
                    const duplicate = pages.find(page => page.contentHash === result.page.contentHash && page.title === result.page.title && (!new URL(page.url).search && !new URL(result.page.url).search || entry.canonical === page.url));
                    if (duplicate) {
                        entry.state = 'duplicate';
                        entry.reason = 'identical_content';
                        entry.canonical = duplicate.url;
                    }
                    else if (acceptedChars + result.page.text.length > 600000) {
                        entry.state = 'failed';
                        entry.reason = 'text_budget';
                        limits.add('text_budget');
                        skipped.push(entry.url);
                        continue;
                    }
                    else {
                        pages.push(result.page);
                        acceptedChars += result.page.text.length;
                    }
                    actions.push(...result.raw.filter(action => normalizeUrl(action.url)).slice(0, 20));
                }
                await opts.onProgress?.(pages.length, skipped.length, maxPages);
                if (queue.length)
                    await sleep(robots.delayMs ? 0 : 50);
            }
        }
        if (queue.length)
            limits.add(signal.aborted ? 'deadline_or_cancelled' : 'page_budget');
        if (signal.aborted)
            limits.add('deadline_or_cancelled');
    }
    finally {
        clearTimeout(timer);
    }
    const all = [...entries.values()], categoriesFetched = [...new Set(all.filter(e => e.state === 'fetched').map(e => e.category))];
    const manifest: CrawlManifest = { version: 1, scope: `same-origin public HTML: ${origin}; max ${maxPages} attempts, depth ${maxDepth}`, startedAt: new Date(deadline - bounded(opts.maxDurationMs, 120000, 300000)).toISOString(), finishedAt: new Date().toISOString(), maxPages, maxRenderedPages: maxRender, maxDepth, maxRequests, networkRequests: network, discovered: entries.size, attempted: attempts, fetched: all.filter(e => e.httpStatus !== undefined && e.httpStatus >= 200 && e.httpStatus < 300 && e.reason !== 'non_html').length, useful: pages.length, rendered: renders, duplicates: all.filter(e => e.state === 'duplicate').length, failed: all.filter(e => e.state === 'failed').length, skipped: all.filter(e => ['excluded', 'gone'].includes(e.state)).length, completeWithinScope: !limits.size && !all.some(e => e.state === 'failed' || e.state === 'pending' || e.reason === 'owner_excluded'), limits: [...limits], entries: all, categoriesFetched, discoveredCategoriesNotFetched: [...new Set(all.filter(e => !categoriesFetched.includes(e.category) && e.state !== 'excluded').map(e => e.category))] };
    return { pages, skipped, actions, manifest };
}
