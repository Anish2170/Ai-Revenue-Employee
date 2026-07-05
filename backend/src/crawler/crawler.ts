/**
 * Website crawler. Breadth-first, same-origin only, bounded by a page cap and
 * per-request timeout, with small wave-based concurrency. Produces clean
 * {@link CrawledPage}s (text extracted, content hashed) for the chunker.
 *
 * It does NOT implement incremental crawling — every run is a full crawl. The
 * per-page `contentHash`/`lastCrawled` it records exist so a future sprint can
 * add "skip unchanged page" without changing this interface.
 */
import { createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { extract } from './extract.js';
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
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'AIRevenueEmployee-Crawler/1.0' },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) return null;
    return await res.text();
  } catch {
    return null;
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

  while (frontier.length > 0 && pages.length < maxPages) {
    const wave = frontier.splice(0, concurrency);
    const results = await Promise.all(
      wave.map(async (url) => {
        visited.add(url);
        const html = await fetchHtml(url, timeoutMs);
        return { url, html };
      }),
    );

    const nextFrontier: string[] = frontier;
    for (const { url, html } of results) {
      if (!html) {
        skipped.push(url);
        continue;
      }
      const { title, text, links } = extract(html, url);

      if (text.length >= 50) {
        const path = new URL(url).pathname || '/';
        pages.push({
          url,
          path,
          title: title || path,
          text,
          pageType: classifyPage(path),
          contentHash: sha256(text),
          lastCrawled: new Date().toISOString(),
        });
      } else {
        skipped.push(url);
      }

      // Enqueue new same-origin links.
      for (const raw of links) {
        const norm = normalizeUrl(raw);
        if (!norm || queued.has(norm) || visited.has(norm)) continue;
        if (!isSameOrigin(norm, origin) || !isCrawlablePath(norm)) continue;
        queued.add(norm);
        nextFrontier.push(norm);
      }
    }
    frontier = nextFrontier;
  }

  return { pages: pages.slice(0, maxPages), skipped };
}
