/**
 * Crawl configuration — tracking-param denylist and path exclusions.
 *
 * These are applied during URL canonicalization and link filtering to produce
 * cleaner, more stable URLs for crawl identity and deduplication.
 */

/** Query parameters stripped during URL canonicalization (analytics/tracking noise). */
export const TRACKING_PARAM_DENYLIST = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_cid', 'mc_eid',
  'ref', 'source', 'referrer',
  '_ga', '_gl', '_hsenc', '_hsmi', '__hstc', '__hsfp',
  'yclid', 'twclid', 'ttclid', 'li_fat_id',
  'spm', 'scm',
]);

/** Path segments that indicate non-content pages (crawl should skip). */
export const PATH_EXCLUSION_PATTERNS = [
  /\/admin(\/|$)/i,
  /\/login(\/|$)/i,
  /\/signup(\/|$)/i,
  /\/register(\/|$)/i,
  /\/account(\/|$)/i,
  /\/dashboard(\/|$)/i,
  /\/cart(\/|$)/i,
  /\/checkout(\/|$)/i,
  /\/my-?(account|orders|profile)(\/|$)/i,
  /\/wp-admin(\/|$)/i,
  /\/wp-login/i,
  /\/api(\/|$)/i,
  /\/graphql(\/|$)/i,
  /\/\.well-known(\/|$)/i,
  /\/feed(\/|$)/i,
  /\/sitemap\.xml$/i,
  /\/robots\.txt$/i,
];

/** Whether a URL path should be excluded from crawling. */
export function isExcludedPath(urlOrPath: string): boolean {
  let path: string;
  try {
    path = new URL(urlOrPath).pathname;
  } catch {
    path = urlOrPath;
  }
  return PATH_EXCLUSION_PATTERNS.some((re) => re.test(path));
}
