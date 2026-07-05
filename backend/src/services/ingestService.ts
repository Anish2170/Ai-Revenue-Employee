/**
 * Ingestion service — THE single knowledge pipeline.
 *
 *   crawl → extract → chunk → embed → index → persist snapshot
 *
 * Sprint 3: accepts optional `websiteId` + `organizationId` for per-website
 * stores, and an `onPhase` callback for SSE build progress. When websiteId is
 * omitted, falls back to the dev singleton (Sprint 2 compat).
 */
import { crawl } from '../crawler/crawler.js';
import { deriveSiteLinks } from '../crawler/links.js';
import { chunkPages } from '../chunking/chunker.js';
import { embedChunks } from '../embeddings/embedder.js';
import { getBusinessInstructions } from '../context/instructions.js';
import { getVectorStore, persistSnapshot } from '../vectorstore/index.js';
import { getWebsiteStore, persistWebsiteSnapshot, invalidateWebsiteStore } from '../vectorstore/registry.js';
import { llmAvailable } from '../llm/index.js';

export type IngestPhase = 'crawling' | 'chunking' | 'embedding' | 'indexing' | 'saving';

export interface IngestOptions {
  websiteId?: string;
  organizationId?: string;
  language?: string;
  onPhase?: (phase: IngestPhase, detail?: Record<string, unknown>) => void;
}

export interface IngestResult {
  sourceUrl: string;
  pages: number;
  chunks: number;
  skipped: number;
  dimensions: number;
  snapshotPath: string;
  durationMs: number;
}

export async function ingest(url: string, opts: IngestOptions = {}): Promise<IngestResult> {
  if (!llmAvailable()) throw new Error('LLM not configured (GEMINI_API_KEY) — cannot generate embeddings.');

  const { websiteId, onPhase, language } = opts;
  const startedAt = Date.now();
  const lang = language ?? getBusinessInstructions().language;

  // 1. Crawl
  onPhase?.('crawling');
  const { pages, skipped } = await crawl(url);
  if (pages.length === 0) throw new Error(`Crawl found no readable pages at ${url}.`);
  onPhase?.('crawling', { pages: pages.length, skipped: skipped.length });

  // 2. Chunk
  onPhase?.('chunking');
  const chunks = chunkPages(pages, lang);
  if (chunks.length === 0) throw new Error('Crawl produced no chunks.');
  onPhase?.('chunking', { chunks: chunks.length });

  // 3. Embed
  onPhase?.('embedding');
  const embedded = await embedChunks(chunks);
  if (embedded.length === 0) throw new Error('Embedding produced no vectors.');
  onPhase?.('embedding', { embedded: embedded.length });

  // 4. Index
  onPhase?.('indexing');
  const siteLinks = deriveSiteLinks(pages);
  const pageMeta = pages.map((p) => ({
    url: p.url,
    path: p.path,
    pageType: p.pageType,
    contentHash: p.contentHash,
    lastCrawled: p.lastCrawled,
  }));

  let snapshotPath: string;
  let dimensions: number;

  if (websiteId) {
    invalidateWebsiteStore(websiteId);
    const { store } = await getWebsiteStore(websiteId);
    await store.indexDocuments(embedded);
    dimensions = store.dimensions();

    onPhase?.('saving');
    snapshotPath = await persistWebsiteSnapshot(websiteId, { sourceUrl: url, siteLinks, pages: pageMeta });
  } else {
    const store = getVectorStore();
    await store.indexDocuments(embedded);
    dimensions = store.dimensions();

    onPhase?.('saving');
    snapshotPath = await persistSnapshot({ sourceUrl: url, siteLinks, pages: pageMeta });
  }

  const result: IngestResult = {
    sourceUrl: url,
    pages: pages.length,
    chunks: embedded.length,
    skipped: skipped.length,
    dimensions,
    snapshotPath,
    durationMs: Date.now() - startedAt,
  };

  console.log(
    `[ingest] ${url} → ${result.pages} pages, ${result.chunks} chunks, ${result.dimensions}d ` +
      `in ${result.durationMs}ms → ${snapshotPath}` +
      (websiteId ? ` (website ${websiteId.slice(0, 8)})` : ''),
  );
  return result;
}
