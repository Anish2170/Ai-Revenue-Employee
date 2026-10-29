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
export async function embedChunks(chunks: Chunk[], options?: { signal?: AbortSignal; deadlineAt?: number }): Promise<EmbeddedChunk[]> {
  if (chunks.length === 0) return [];
  const vectors = await embedTexts(
    chunks.map((c) => `${c.heading}\n\n${c.content}`),
    'document',
    options,
  );
  const dims = vectors[0]?.length ?? 0;
  if(vectors.length!==chunks.length || !dims || vectors.some(v=>v.length!==dims||v.some(n=>!Number.isFinite(n))||!v.some(n=>n!==0)))throw Error('Embedding produced incomplete or invalid vectors.');
  return chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] }));
}

/** Embed a single search query (query mode). */
export async function embedQuery(query: string, options?: { signal?: AbortSignal; deadlineAt?: number }): Promise<number[]> {
  const [vector] = await embedTexts([query], 'query', options);
  return vector ?? [];
}
