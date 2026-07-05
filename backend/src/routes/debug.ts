/**
 * Dev-only debug endpoints. Disabled in production (returns 404) so they never
 * leak internal state on a live deployment.
 *
 * GET /debug/rag — inspect the loaded knowledge index: index summary, per-page
 * list, per-chunk details, and chunk-size stats.
 */
import { Router } from 'express';
import { config } from '../config/index.js';
import { getLoadedMeta, getVectorStore, knowledgeReady } from '../vectorstore/index.js';

export const debugRouter = Router();

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

debugRouter.get('/debug/rag', (_req, res) => {
  if (config.isProduction) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const store = getVectorStore();
  const meta = getLoadedMeta();
  const docs = store.export();

  // Per-chunk details.
  const chunks = docs.map((c) => {
    const words = wordCount(c.content);
    const chars = c.content.length;
    return {
      id: c.id,
      page: c.page,
      section: c.section,
      heading: c.heading,
      wordCount: words,
      charCount: chars,
      preview: c.content.slice(0, 150),
    };
  });

  // Chunk-size stats (by word count).
  const sizes = chunks.map((c) => c.wordCount);
  const totalWords = sizes.reduce((a, b) => a + b, 0);
  const bySize = [...chunks].sort((a, b) => a.wordCount - b.wordCount);
  const stats = {
    totalChunks: chunks.length,
    averageChunkWords: chunks.length ? Math.round(totalWords / chunks.length) : 0,
    smallestChunk: bySize[0] ? { id: bySize[0].id, wordCount: bySize[0].wordCount } : null,
    largestChunk: bySize.length
      ? { id: bySize[bySize.length - 1].id, wordCount: bySize[bySize.length - 1].wordCount }
      : null,
  };

  res.json({
    knowledgeReady: knowledgeReady(),
    source: knowledgeReady() ? 'rag' : 'fallback',
    pagesCrawled: meta?.pages.length ?? 0,
    chunks: store.size(),
    embeddingDimensions: store.dimensions(),
    embeddingModel: meta?.embeddingModel ?? config.gemini.embeddingModel,
    snapshotCreatedAt: meta?.createdAt ?? null,
    sourceUrl: meta?.sourceUrl ?? null,
    pages:
      meta?.pages.map((p) => ({ path: p.path, pageType: p.pageType, lastCrawled: p.lastCrawled })) ?? [],
    stats,
    chunkDetails: chunks,
  });
});
