/**
 * Embedding step of the pipeline. Wraps the provider-agnostic `embedTexts()`
 * facade so the crawler/ingest layers never touch the LLM provider directly.
 *
 * Chunks are embedded as DOCUMENTS, search queries as QUERIES (Gemini uses the
 * task type to improve retrieval quality).
 */
import { embedTexts } from '../llm/index.js';
import type { Chunk, EmbeddedChunk } from '../context/types.js';

/** Embed chunks (document mode) and attach the vectors. */
export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];
  const vectors = await embedTexts(
    chunks.map((c) => `${c.heading}\n\n${c.content}`),
    'document',
  );
  return chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] ?? [] }))
    .filter((c) => c.embedding.length > 0);
}

/** Embed a single search query (query mode). */
export async function embedQuery(query: string): Promise<number[]> {
  const [vector] = await embedTexts([query], 'query');
  return vector ?? [];
}
