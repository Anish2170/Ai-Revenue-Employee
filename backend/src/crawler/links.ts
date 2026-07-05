/**
 * Link utilities: URL normalization, same-origin filtering, page-type
 * classification, and deriving navigable site links from crawled pages.
 */
import { TRACKING_PARAM_DENYLIST, isExcludedPath } from '../config/crawl.js';
import type { CrawledPage, PageType } from '../context/types.js';
import type { SiteLink } from '../types.js';

/**
 * Normalize a URL: strip hash, remove tracking params, sort remaining params,
 * drop trailing slash (except root), lowercase host.
 */
export function normalizeUrl(input: string, base?: string): string | null {
  try {
    const u = new URL(input, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';

    const cleaned = new URLSearchParams();
    const entries = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM_DENYLIST.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of entries) cleaned.set(k, v);
    const qs = cleaned.toString();

    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${u.protocol}//${u.host.toLowerCase()}${path}${qs ? `?${qs}` : ''}`;
  } catch {
    return null;
  }
}

/** Whether `url` is on the same origin as `origin`. */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/** Skip non-content resources (by extension) and excluded paths (admin, login, etc.). */
export function isCrawlablePath(url: string): boolean {
  const path = (() => {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  })();
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|svg|webp|ico|css|js|mp4|mp3|woff2?|ttf|xml|json)$/.test(path)) return false;
  if (isExcludedPath(path)) return false;
  return true;
}

/** Classify a page from its path. */
export function classifyPage(path: string): PageType {
  const p = path.toLowerCase();
  if (p === '/' || p === '') return 'home';
  if (/about|team|company|mission/.test(p)) return 'about';
  if (/pricing|plans?|cost/.test(p)) return 'pricing';
  if (/faq|help|support|questions/.test(p)) return 'faq';
  if (/contact|get-in-touch|reach/.test(p)) return 'contact';
  if (/book|demo|schedule|call|meeting/.test(p)) return 'contact';
  if (/case-?stud(y|ies)|customers?|success|results/.test(p)) return 'case-study';
  if (/blog|article|news|post/.test(p)) return 'blog';
  if (/service|solution|product|feature/.test(p)) return 'services';
  return 'other';
}

const LINK_LABELS: Partial<Record<PageType, string>> = {
  pricing: 'See pricing',
  contact: 'Contact us',
  services: 'Explore services',
  about: 'About us',
  faq: 'View FAQ',
  'case-study': 'View case studies',
  blog: 'Read the blog',
};

/**
 * Derive a small, de-duplicated set of navigable links from crawled pages —
 * used by the popup CTA allowlist. Prefers meaningful page types over "other".
 */
export function deriveSiteLinks(pages: CrawledPage[]): SiteLink[] {
  const byType = new Map<PageType, SiteLink>();
  for (const page of pages) {
    if (page.pageType === 'home' || page.pageType === 'other' || page.pageType === 'blog') continue;
    if (byType.has(page.pageType)) continue;
    byType.set(page.pageType, {
      label: LINK_LABELS[page.pageType] ?? page.title.slice(0, 40),
      url: page.path,
    });
  }
  return [...byType.values()];
}
