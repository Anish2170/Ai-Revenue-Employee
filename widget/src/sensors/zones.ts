/**
 * Zone resolution (§3.1) — map a DOM element to a semantic zone.
 *
 * The architecture's end state is a `zoneMap` derived from the RAG crawl and
 * served to the widget at load. Sprint 4.1 ships the consuming seam plus a
 * pragmatic client-side heuristic fallback, so perception works before the
 * served map exists. `setZoneMap()` lets the backend override the heuristic.
 *
 * Heuristic only — cheap keyword matching over ids/classes/attributes/href and
 * the URL path. Never reads user content; only structural hints.
 */
import type { Zone } from './types.js';

/** Optional backend-provided selector→zone map (served at load; §3.1). */
interface ZoneRule {
  selector: string;
  zone: Zone;
}
let servedRules: ZoneRule[] = [];

/** Install the crawl-derived zone map (called once at load if provided). */
export function setZoneMap(rules: ZoneRule[]): void {
  servedRules = Array.isArray(rules) ? rules : [];
}

const KEYWORDS: Array<{ zone: Zone; re: RegExp }> = [
  { zone: 'pricing', re: /(pricing|price|plan|tier|subscri|cost|quote|billing)/i },
  { zone: 'faq', re: /(faq|question|help|support|docs|documentation)/i },
  { zone: 'trust', re: /(testimonial|review|about|team|award|guarantee|trust|case-?study|logos?)/i },
  { zone: 'contact', re: /(contact|book|demo|appointment|schedule|call|email|enquir|inquir)/i },
  { zone: 'product', re: /(product|feature|service|solution|listing|catalog|item)/i },
  { zone: 'cta', re: /(cta|buy|checkout|signup|sign-up|get-started|start|subscribe|add-to-cart|purchase)/i },
];

/** Is this element a call-to-action (button/link with actiony intent)? */
export function isCtaElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return true;
  if (tag === 'a') {
    const href = (el as HTMLAnchorElement).getAttribute('href') ?? '';
    if (/^(tel:|mailto:|https?:\/\/(wa\.me|api\.whatsapp))/i.test(href)) return true;
  }
  const hay = `${el.id} ${el.className} ${el.getAttribute('role') ?? ''}`;
  return /(cta|btn|button|buy|checkout|signup|get-?started|book|subscribe|add-to-cart)/i.test(hay);
}

/** True when the element (or ancestor) is a tel:/whatsapp link — a mobile conversion. */
export function isContactLink(el: Element): boolean {
  const a = el.closest('a');
  if (!a) return false;
  const href = a.getAttribute('href') ?? '';
  return /^(tel:|mailto:|https?:\/\/(wa\.me|api\.whatsapp))/i.test(href);
}

/**
 * Resolve the semantic zone for an element. Walks a few ancestors so a click on
 * an inner span still resolves to its section. Falls back to URL-path hints,
 * then 'other'.
 */
export function resolveZone(el: Element | null): Zone {
  if (!el) return zoneFromPath();

  // 1. Backend-served map wins if a selector matches.
  for (const rule of servedRules) {
    try {
      if (el.closest(rule.selector)) return rule.zone;
    } catch {
      /* invalid selector — ignore */
    }
  }

  // 2. CTA is a strong structural signal.
  if (isCtaElement(el)) return 'cta';

  // 3. Keyword scan up the ancestor chain (bounded depth).
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < 6) {
    const hay = `${node.id} ${node.className} ${node.getAttribute?.('data-section') ?? ''} ${node.getAttribute?.('aria-label') ?? ''}`;
    for (const { zone, re } of KEYWORDS) {
      if (re.test(hay)) return zone;
    }
    node = node.parentElement;
    depth++;
  }

  // 4. Fall back to the page path.
  return zoneFromPath();
}

/** Coarse zone from the URL path (a whole pricing page → pricing zone). */
export function zoneFromPath(): Zone {
  const path = (typeof window !== 'undefined' ? window.location.pathname : '') || '';
  for (const { zone, re } of KEYWORDS) {
    if (re.test(path)) return zone;
  }
  return 'other';
}
