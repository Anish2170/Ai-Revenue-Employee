/**
 * Website crawler. Breadth-first, same-origin only, bounded by a page cap and
 * per-request timeout, with small wave-based concurrency. Produces clean
 * {@link CrawledPage}s (text extracted, content hashed) for the chunker.
 *
 * Static HTML is tried first for speed and WordPress-style sites. If a page has
 * too little readable text, the crawler falls back to a headless browser render
 * so React/Vite/Next/Vue/Angular pages can execute client-side JavaScript before
 * extraction.
 */
import { createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { extract, inspectHtml, type HtmlInspection } from './extract.js';
import { extractActionsFromHtml, type RawDiscoveredAction } from '../business-actions/actionDiscovery.js';
import { renderPage, type RenderedPage } from './browserRenderer.js';
import { classifyPage, isCrawlablePath, isSameOrigin, normalizeUrl } from './links.js';
import type { CrawledPage } from '../context/types.js';

export interface CrawlOptions {
  maxPages?: number;
  concurrency?: number;
  timeoutMs?: number;
}

export interface CrawlResult {
  pages: CrawledPage[];
  /** URLs that were fetched but failed or had no usable content. */
  skipped: string[];
  actions: RawDiscoveredAction[];
}

interface FetchResult {
  ok: boolean;
  url: string;
  status: number | null;
  contentType: string;
  html: string | null;
  error: string | null;
}

const MIN_READABLE_CHARS = 50;

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function fetchHtml(url: string, timeoutMs: number): Promise<FetchResult> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'AIRevenueEmployee-Crawler/1.0' },
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      return { ok: false, url: res.url || url, status: res.status, contentType: type, html: null, error: `http_status_${res.status}` };
    }
    if (!type.includes('text/html')) {
      return { ok: false, url: res.url || url, status: res.status, contentType: type, html: null, error: `non_html_content_type:${type || 'missing'}` };
    }
    return { ok: true, url: res.url || url, status: res.status, contentType: type, html: await res.text(), error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, url, status: null, contentType: '', html: null, error: `fetch_error:${message}` };
  }
}

/**
 * Crawl a site starting from `startUrl`.
 * @returns the crawled pages plus any skipped URLs.
 */
export async function crawl(startUrl: string, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? config.crawl.maxPages;
  const concurrency = opts.concurrency ?? config.crawl.concurrency;
  const timeoutMs = opts.timeoutMs ?? config.crawl.timeoutMs;

  const start = normalizeUrl(startUrl);
  if (!start) throw new Error(`Invalid start URL: ${startUrl}`);
  const origin = new URL(start).origin;

  const visited = new Set<string>();
  const queued = new Set<string>([start]);
  let frontier: string[] = [start];

  const pages: CrawledPage[] = [];
  const skipped: string[] = [];
  const actions: RawDiscoveredAction[] = [];

  while (frontier.length > 0 && pages.length < maxPages) {
    const wave = frontier.splice(0, concurrency);
    const results = await Promise.all(
      wave.map(async (url) => {
        visited.add(url);
        return crawlOnePage(url, timeoutMs);
      }),
    );

    const nextFrontier: string[] = frontier;
    for (const result of results) {
      if (!result.page) {
        skipped.push(result.url);
      } else if (pages.length < maxPages) {
        pages.push(result.page);
      }

      // Enqueue new same-origin links even from pages rejected for low text; a
      // shell page may still expose crawlable nav links after rendering.
      actions.push(...result.actions);

      for (const raw of result.links) {
        const norm = normalizeUrl(raw);
        if (!norm || queued.has(norm) || visited.has(norm)) continue;
        if (!isSameOrigin(norm, origin) || !isCrawlablePath(norm)) continue;
        queued.add(norm);
        nextFrontier.push(norm);
      }
    }
    frontier = nextFrontier;
  }

  return { pages: pages.slice(0, maxPages), skipped, actions };
}

async function crawlOnePage(url: string, timeoutMs: number): Promise<{ url: string; page: CrawledPage | null; links: string[]; actions: RawDiscoveredAction[] }> {
  const fetched = await fetchHtml(url, timeoutMs);
  if (!fetched.ok || !fetched.html) {
    logCrawlPage({
      phase: 'static_fetch',
      requestedUrl: url,
      status: fetched.status,
      finalUrl: fetched.url,
      readyState: 'not_loaded',
      bodyTextLength: 0,
      bodyTextFirst500: '',
      headingCount: 0,
      paragraphCount: 0,
      linkCount: 0,
      extractedTextLength: 0,
      accepted: false,
      rejectionReason: fetched.error ?? 'fetch_failed',
    });
    return { url, page: null, links: [], actions: [] };
  }

  const staticInspection = inspectHtml(fetched.html);
  const staticExtracted = extract(fetched.html, fetched.url);
  const staticReason = staticExtracted.text.length < MIN_READABLE_CHARS
    ? `minimum_content_validation:text_length_${staticExtracted.text.length}_below_${MIN_READABLE_CHARS}`
    : null;

  logCrawlPage({
    phase: 'static_fetch',
    requestedUrl: url,
    status: fetched.status,
    finalUrl: fetched.url,
    readyState: 'static_html_no_js',
    bodyTextLength: staticInspection.bodyText.length,
    bodyTextFirst500: staticInspection.bodyText.slice(0, 500),
    headingCount: staticInspection.headingCount,
    paragraphCount: staticInspection.paragraphCount,
    linkCount: staticInspection.linkCount,
    extractedTextLength: staticExtracted.text.length,
    accepted: staticReason === null,
    rejectionReason: staticReason,
  });

  if (!staticReason) {
    const page = toCrawledPage(fetched.url, staticExtracted.title, staticExtracted.text);
    return { url, page, links: staticExtracted.links, actions: extractActionsFromHtml(fetched.html, page) };
  }

  try {
    const rendered = await renderPage(fetched.url, timeoutMs);
    const renderedExtracted = extract(rendered.html, rendered.url);
    const renderedReason = renderedExtracted.text.length < MIN_READABLE_CHARS
      ? `minimum_content_validation:text_length_${renderedExtracted.text.length}_below_${MIN_READABLE_CHARS}`
      : null;

    logRenderedCrawlPage(url, rendered, renderedExtracted.text.length, renderedReason);

    if (!renderedReason) {
      const page = toCrawledPage(rendered.url, renderedExtracted.title, renderedExtracted.text);
      return { url, page, links: renderedExtracted.links, actions: extractActionsFromHtml(rendered.html, page) };
    }
    return { url, page: null, links: renderedExtracted.links, actions: [] };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logCrawlPage({
      phase: 'browser_render',
      requestedUrl: url,
      status: fetched.status,
      finalUrl: fetched.url,
      readyState: 'render_failed',
      bodyTextLength: staticInspection.bodyText.length,
      bodyTextFirst500: staticInspection.bodyText.slice(0, 500),
      headingCount: staticInspection.headingCount,
      paragraphCount: staticInspection.paragraphCount,
      linkCount: staticInspection.linkCount,
      extractedTextLength: staticExtracted.text.length,
      accepted: false,
      rejectionReason: `browser_render_failed:${reason}`,
    });
    return { url, page: null, links: staticExtracted.links, actions: [] };
  }
}

function toCrawledPage(url: string, title: string, text: string): CrawledPage {
  const path = new URL(url).pathname || '/';
  return {
    url,
    path,
    title: title || path,
    text,
    pageType: classifyPage(path),
    contentHash: sha256(text),
    lastCrawled: new Date().toISOString(),
  };
}

function logRenderedCrawlPage(
  requestedUrl: string,
  rendered: RenderedPage,
  extractedTextLength: number,
  rejectionReason: string | null,
): void {
  logCrawlPage({
    phase: `browser_render:${rendered.waitStrategy.join('+')}`,
    requestedUrl,
    status: rendered.status,
    finalUrl: rendered.url,
    readyState: rendered.readyState,
    bodyTextLength: rendered.bodyText.length,
    bodyTextFirst500: rendered.bodyText.slice(0, 500),
    headingCount: rendered.headingCount,
    paragraphCount: rendered.paragraphCount,
    linkCount: rendered.linkCount,
    extractedTextLength,
    accepted: rejectionReason === null,
    rejectionReason,
  });
}

function logCrawlPage(detail: {
  phase: string;
  requestedUrl: string;
  status: number | null;
  finalUrl: string;
  readyState: string;
  bodyTextLength: number;
  bodyTextFirst500: string;
  headingCount: number;
  paragraphCount: number;
  linkCount: number;
  extractedTextLength: number;
  accepted: boolean;
  rejectionReason: string | null;
}): void {
  if (!config.debugTrace) return;
  console.log('[crawl:page]', JSON.stringify(detail));
}
