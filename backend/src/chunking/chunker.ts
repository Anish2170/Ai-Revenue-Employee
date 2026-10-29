/** Source/section-bound chunks; short factual sections are not trailing junk. */
import { createHash } from 'node:crypto';
import type { Chunk, CrawledPage, ContentSection } from '../context/types.js';
import { usefulBusinessText } from '../crawler/contentPolicy.js';
const TARGET_WORDS = 650, MAX_WORDS = 800, MAX_UNIT_CHARS = 8000;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const words = (text: string) => text.split(/\s+/u).filter(Boolean).length;
function legacySections(page: CrawledPage): ContentSection[] {
    const sections: ContentSection[] = [];
    let heading = page.title, parts: string[] = [];
    const flush = () => { if (parts.length)
        sections.push({ heading, text: parts.join('\n\n') }); parts = []; };
    for (const block of page.text.split(/\n{2,}/u).map(s => s.trim()).filter(Boolean)) {
        if (block.length <= 80 && words(block) <= 10 && !/[.!?:$₹€£¥]/u.test(block) && /\p{L}/u.test(block) && !usefulBusinessText(block)) {
            flush();
            heading = block;
        }
        else
            parts.push(block);
    }
    flush();
    return sections;
}
export interface ChunkingResult {
    chunks: Chunk[];
    omitted: Array<{
        url: string;
        heading: string;
        reason: 'low_value' | 'oversized_semantic_unit';
    }>;
}
export function buildChunks(pages: CrawledPage[], language: string): ChunkingResult {
    const chunks: Chunk[] = [], omitted: ChunkingResult['omitted'] = [];
    for (const page of pages) {
        for (const section of page.sections?.length ? page.sections : legacySections(page)) {
            if (!usefulBusinessText(section.text)) {
                omitted.push({ url: page.url, heading: section.heading, reason: 'low_value' });
                continue;
            }
            const sensitive = /[$₹€£¥]\s*\d|refund|billed|subject to|conditions|not offered|only .*customers|excluding|including/i.test(section.text);
            if (sensitive && (words(section.text) > MAX_WORDS || section.text.length > MAX_UNIT_CHARS)) {
                omitted.push({ url: page.url, heading: section.heading, reason: 'oversized_semantic_unit' });
                continue;
            }
            const paragraphs = section.text.split(/\n{2,}/u).map(s => s.trim()).filter(Boolean);
            let parts: string[] = [], size = 0;
            const flush = () => {
                if (!parts.length)
                    return;
                const content = parts.join('\n\n');
                parts = [];
                size = 0;
                const identity = hash(`${page.url}\n${section.heading}\n${content}`).slice(0, 16);
                const chunk: Chunk = { id: `${new URL(page.url).pathname}${new URL(page.url).search}#${identity}`, page: page.path, url: page.url, pageType: page.pageType, section: section.heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 80), heading: section.heading || page.title, title: page.title, language, hash: hash(content), lastCrawled: page.lastCrawled, content };
                const repeated = chunk.heading === 'Public contact and hours' ? chunks.find(other => other.heading === chunk.heading && other.hash === chunk.hash) : undefined;
                if (repeated) {
                    (repeated.sourceAliases ??= []).push({ url: chunk.url, title: chunk.title, heading: chunk.heading });
                }
                else if (!chunks.some(other => other.id === chunk.id))
                    chunks.push(chunk);
            };
            for (const paragraph of paragraphs) {
                if (paragraph.length > MAX_UNIT_CHARS) {
                    flush();
                    omitted.push({ url: page.url, heading: section.heading, reason: 'oversized_semantic_unit' });
                    continue;
                }
                // Never slice an individual sentence/qualification. Larger paragraphs
                // may exceed the word target but remain under a hard whole-unit cap.
                if ((size + words(paragraph) > MAX_WORDS || parts.join("\n\n").length + paragraph.length > MAX_UNIT_CHARS) && parts.length)
                    flush();
                parts.push(paragraph);
                size += words(paragraph);
                // Sensitive sections stay atomic, including short trailing qualifications.
            }
            flush();
        }
    }
    return { chunks, omitted };
}
export function chunkPages(pages: CrawledPage[], language: string): Chunk[] { return buildChunks(pages, language).chunks; }
