/**
 * HTML → clean readable text extraction (cheerio).
 *
 * Strips structural/non-content elements (scripts, styles, nav, header, footer,
 * forms, cookie/consent banners, etc.) and returns the page title, normalized
 * text, and the in-page links for the crawler frontier.
 */
import * as cheerio from 'cheerio';

const STRIP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'svg',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'iframe',
  'template',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
  '[hidden]',
  // Common cookie/consent/ad containers.
  '[id*="cookie" i]',
  '[class*="cookie" i]',
  '[id*="consent" i]',
  '[class*="consent" i]',
  '[class*="banner" i]',
  '[id*="newsletter" i]',
  '[class*="advert" i]',
  '[class*="-ad" i]',
].join(', ');

export interface ExtractedPage {
  title: string;
  text: string;
  /** Absolute hrefs found on the page. */
  links: string[];
}

export interface HtmlInspection {
  bodyText: string;
  headingCount: number;
  paragraphCount: number;
  linkCount: number;
}

/** Collapse whitespace, normalize newlines, trim. */
export function normalizeText(input: string): string {
  return input
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

export function inspectHtml(html: string): HtmlInspection {
  const $ = cheerio.load(html);
  return {
    bodyText: normalizeText($('body').text()),
    headingCount: $('h1, h2, h3, h4, h5, h6').length,
    paragraphCount: $('p').length,
    linkCount: $('a[href]').length,
  };
}

export function extract(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title = ($('title').first().text() || $('h1').first().text() || '').trim();

  // Collect links BEFORE stripping (nav links are still useful for discovery).
  const links: string[] = [];
  $('a[href]').each((_i, a) => {
    const href = $(a).attr('href');
    if (href) {
      try {
        links.push(new URL(href, pageUrl).toString());
      } catch {
        /* ignore malformed href */
      }
    }
  });

  // Remove non-content elements, then take the best content root.
  $(STRIP_SELECTORS).remove();
  const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');

  // Block-level newlines so headings/paragraphs don't run together.
  root.find('h1, h2, h3, h4, h5, h6, p, li, br, div, section, tr').each((_i, el) => {
    $(el).append('\n');
  });

  const text = normalizeText(root.text());
  return { title, text, links };
}
