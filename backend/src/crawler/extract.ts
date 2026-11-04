/** DOM-aware text extraction. Source wording remains data, not instructions. */
import * as cheerio from 'cheerio';
import type { ContentSection } from '../context/types.js';
import { hasLoadingPlaceholder, usefulBusinessText } from './contentPolicy.js';
const STRIP_SELECTORS = 'script,style,noscript,svg,nav,[role="navigation"],input,textarea,select,button,label,iframe,template,[aria-hidden="true"],[hidden],[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[class*="advert" i],[id*="newsletter" i]';
export interface ExtractedPage {
    title: string;
    text: string;
    links: string[];
    sections: ContentSection[];
    canonical: string | null;
    meaningfulChars: number;
    needsRendering: boolean;
    cleaning: {
        removedNavigation: boolean;
        removedFooter: boolean;
        removedScripts: boolean;
        removedCookieBanners: boolean;
        beforeLength: number;
        afterLength: number;
    };
    structuredDataBlocks: number;
}
export interface HtmlInspection {
    bodyText: string;
    headingCount: number;
    paragraphCount: number;
    linkCount: number;
}
export function normalizeText(input: string): string { return input.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map(line => line.trim()).join('\n').trim(); }
export function inspectHtml(html: string): HtmlInspection { const $ = cheerio.load(html); return { bodyText: normalizeText($('body').text()), headingCount: $('h1,h2,h3,h4,h5,h6').length, paragraphCount: $('p').length, linkCount: $('a[href]').length }; }
export function extract(html: string, pageUrl: string): ExtractedPage {
    const $ = cheerio.load(html), title = normalizeText($('title').first().text() || $('h1').first().text());
    const links: string[] = [];
    $('a[href]').each((_i, a) => { try {
        links.push(new URL($(a).attr('href')!, pageUrl).href);
    }
    catch { } });
    let canonical: string | null = null;
    try {
        const href = $('link[rel="canonical"]').first().attr('href');
        if (href)
            canonical = new URL(href, pageUrl).href;
    }
    catch { }
    const beforeLength = normalizeText($('body').text()).length;
    const cleaning = { removedNavigation: $('nav,[role="navigation"]').length > 0, removedFooter: $('footer').length > 0, removedScripts: $('script').length > 0, removedCookieBanners: $('[id*="cookie" i],[class*="cookie" i],[id*="consent" i]').length > 0, beforeLength, afterLength: 0 };
    const structuredDataBlocks = $('script[type="application/ld+json"]').length;
    const jsShell = $('script[type="module"],script[src*="_next"],script[src*="app"],#root,#app,#__next').length > 0;
    // Comparison tables often encode their most important value as an icon.
    // Preserve explicit check/cross semantics before decorative SVGs disappear.
    $('td svg,th svg').each((_i, node) => {
        const icon = $(node), label = icon.attr('aria-label') || icon.find('title').text();
        const classes = icon.attr('class') ?? '';
        const value = /^(?:yes|included|available|true|check)$/iu.test(label) || /\blucide-check(?:-icon)?\b/u.test(classes) ? 'Included'
            : /^(?:no|not included|unavailable|false|cross)$/iu.test(label) || /\blucide-x(?:-icon)?\b/u.test(classes) ? 'Not included' : '';
        if (value) icon.replaceWith(value);
    });
    // Keep public footer/address facts, but never transplant the footer navigation.
    const footerFacts: string[] = [];
    $('footer p,footer address,aside address,footer a[href^="tel:"],footer a[href^="mailto:"]').each((_i, node) => { const copy = $(node).clone(); copy.find('nav,script,style,input,button').remove(); const text = normalizeText(copy.text()); if (/\b(?:hours?|closed|monday|sunday|am|pm)\b|@|\+?\d[\d ().-]{5,}/iu.test(text) || $(node).is('address'))
        footerFacts.push(text); });
    $(STRIP_SELECTORS).remove();
    $('body > header,body > footer,footer,body > aside,[role="banner"],[role="contentinfo"]').remove();
    const root = $('main').first().length ? $('main').first() : $('article').first().length ? $('article').first() : $('body');
    const sections: ContentSection[] = [];
    let heading = title, pieces: string[] = [];
    const flush = () => { const text = normalizeText(pieces.join('\n\n')); if (text)
        sections.push({ heading, text }); pieces = []; };
    const visit = (node: any): void => {
        if (node.type === 'text') {
            const text = normalizeText(node.data ?? '');
            if (text)
                pieces.push(text);
            return;
        }
        const tag = String(node.tagName ?? '').toLowerCase();
        if (!tag)
            return;
        if (/^h[1-6]$/.test(tag)) {
            flush();
            heading = normalizeText($(node).text()) || heading;
            return;
        }
        if (tag === 'table') {
            flush();
            const rows: string[][] = [];
            $(node).find('tr').each((_i, row) => { rows.push($(row).children('th,td').map((_j, cell) => normalizeText($(cell).clone().find('p,div,li,br').append('\n').end().text())).get()); });
            const notes = normalizeText($(node).find('caption').text() + ' ' + $(node).next('[role=note],.footnote,.disclaimer,[id*=footnote]').text());
            const rowPrices = rows[0]?.slice(1).some(cell => /^(?:price|cost|fee|rate)(?:\s|$)/iu.test(cell));
            if (rows.length > 1 && rows[0].length > 1 && $(node).find('thead th').length > 1 && !rowPrices) {
                // Transpose comparison tables: each product keeps prices AND billing/footnotes.
                for (let col = 1; col < rows[0].length; col++)
                    sections.push({ heading: rows[0][col], text: [rows[0][col], ...rows.slice(1).map(row => row[col] !== undefined ? `${row[0]}: ${row[col]}` : row[0]), ...(notes ? [notes] : [])].join('\n\n') });
            }
            else if (rowPrices) {
                for (const row of rows.slice(1)) sections.push({ heading: row[0], text: [...row, ...(notes ? [notes] : [])].join('\n') });
            } else
                pieces.push(rows.map(row => row.join(' | ')).join('\n'));
            return;
        }
        // Keep the smallest complete price card as one source unit. Joining
        // inline .text() loses the service/qualification boundary in span cards.
        if (['div', 'section', 'article'].includes(tag)) {
            const textNodes: string[] = [];
            const collect = (part: any) => { if (part.type === 'text') { const value = normalizeText(part.data ?? ''); if (value) textNodes.push(value); } else $(part).contents().toArray().forEach(collect); };
            collect(node);
            const money = textNodes.filter(text => /^(?:[$₹€£¥]|USD|INR|EUR|GBP|CAD|AUD)\s*\d/u.test(text));
            const text = textNodes.join('\n');
            if (money.length === 1 && textNodes.length >= 2 && text.length < 700 && !$(node).find('a,button,table').length && textNodes[0] !== money[0]) {
                flush();
                sections.push({ heading: textNodes[0], text });
                return;
            }
        }
        if (['p', 'li', 'address', 'summary', 'dt', 'dd'].includes(tag)) {
            const text = normalizeText($(node).text());
            if (text)
                pieces.push(text);
            return;
        }
        const children = $(node).contents().toArray();
        // A non-semantic price card is one unit so currency/qualifiers don't split.
        if (['div', 'section'].includes(tag) && !$(node).find('h1,h2,h3,h4,h5,h6,p,li,table,section,div').length) {
            const text = normalizeText($(node).text());
            if (text)
                pieces.push(text);
            return;
        }
        children.forEach(visit);
    };
    root.contents().toArray().forEach(visit);
    flush();
    for (const text of new Set(footerFacts))
        if (!sections.some(section => section.text.includes(text)))
            sections.push({ heading: 'Public contact and hours', text });
    const text = normalizeText(sections.map(section => section.heading && section.heading !== title ? `${section.heading}\n\n${section.text}` : section.text).join('\n\n'));
    cleaning.afterLength = text.length;
    // Long loading shells are not considered complete merely because nav/prose is long.
    const incomplete = $('[aria-busy="true"],[class*="skeleton" i],[data-loading]').length > 0 || /pricing|plans|products/i.test(new URL(pageUrl).pathname) && !/[$₹€£¥]\s*\d/.test(text);
    const placeholder = hasLoadingPlaceholder(text);
    const meaningfulChars = sections.filter(section => usefulBusinessText(section.text)).reduce((n, section) => n + section.text.length, 0);
    // A hydrated short policy/price remains valid business content even when an
    // app root/script survives in the DOM. Explicit loading/busy signals still
    // win; length alone cannot invalidate an otherwise authoritative short fact.
    const shortFact = meaningfulChars > 0 && usefulBusinessText(text);
    return { title, text, links, sections, canonical, meaningfulChars, needsRendering: jsShell && (placeholder || incomplete || meaningfulChars < 80 && !shortFact), cleaning, structuredDataBlocks };
}
