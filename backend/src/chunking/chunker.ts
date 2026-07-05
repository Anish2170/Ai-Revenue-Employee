/**
 * Chunker. Splits each crawled page's clean text into ~500–800 word chunks that
 * respect natural boundaries (blank-line separated blocks / paragraphs), and
 * attaches rich metadata to every chunk.
 *
 * Each chunk also gets its own content hash (future chunk-level incremental
 * diffing) and a `language` tag (from business instructions for now — no
 * per-chunk detection yet).
 */
import { createHash } from 'node:crypto';
import type { Chunk, CrawledPage } from '../context/types.js';

const TARGET_WORDS = 650; // middle of the 500–800 band
const MAX_WORDS = 800;
const MIN_WORDS = 40; // drop trivially small trailing fragments

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/** Heuristic: a short, title-like line with no terminal punctuation is a heading. */
function isHeading(block: string): boolean {
  const t = block.trim();
  if (t.length === 0 || t.length > 80) return false;
  return wordCount(t) <= 10 && !/[.!?:]$/.test(t);
}

/**
 * Split one page into chunks. Accumulates blocks until ~TARGET_WORDS, breaking
 * at block boundaries; never exceeds MAX_WORDS. Tracks the most recent heading
 * so each chunk carries its section/heading.
 */
function chunkPage(page: CrawledPage, language: string): Chunk[] {
  const blocks = page.text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks: Chunk[] = [];

  let buffer: string[] = [];
  let bufferWords = 0;
  let currentHeading = page.title;
  let index = 0;

  const flush = () => {
    const content = buffer.join('\n\n').trim();
    buffer = [];
    bufferWords = 0;
    if (wordCount(content) < MIN_WORDS) return;
    const heading = currentHeading || page.title;
    chunks.push({
      id: `${page.path}#${index}`,
      page: page.path,
      url: page.url,
      pageType: page.pageType,
      section: slugify(heading) || `section-${index}`,
      heading,
      title: page.title,
      language,
      hash: sha256(content),
      lastCrawled: page.lastCrawled,
      content,
    });
    index += 1;
  };

  for (const block of blocks) {
    if (isHeading(block)) {
      // A new heading starts a new section; flush if we already have content.
      if (bufferWords >= TARGET_WORDS) flush();
      currentHeading = block;
    }
    const w = wordCount(block);
    if (bufferWords + w > MAX_WORDS && bufferWords > 0) flush();
    buffer.push(block);
    bufferWords += w;
    if (bufferWords >= TARGET_WORDS) flush();
  }
  flush();

  return chunks;
}

/** Chunk all crawled pages. */
export function chunkPages(pages: CrawledPage[], language: string): Chunk[] {
  return pages.flatMap((page) => chunkPage(page, language));
}
