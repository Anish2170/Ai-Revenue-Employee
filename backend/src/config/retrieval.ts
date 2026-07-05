/**
 * Retrieval configuration — kept out of business logic so RAG can be tuned
 * without code changes.
 *
 * NOTE on `similarityThreshold`: cosine scores are model-specific. For
 * gemini-embedding-001, genuinely relevant chunks frequently score in the
 * 0.4–0.7 range, so a high threshold (e.g. 0.75) can silently filter everything
 * and force the fallback forever. We default LOW and log actual scores so it can
 * be tuned against real data.
 */
export interface RetrievalConfig {
  /** How many nearest chunks to pull before threshold filtering. */
  topK: number;
  /** Minimum cosine similarity for a chunk to be considered relevant. */
  similarityThreshold: number;
  /** Max total characters of chunk content injected into the prompt (~9000 ≈ ~2.5k tokens). */
  maxContextChars: number;
}

export const retrievalConfig: RetrievalConfig = {
  topK: Number(process.env.RETRIEVAL_TOP_K ?? 5),
  similarityThreshold: Number(process.env.RETRIEVAL_MIN_SCORE ?? 0.5),
  maxContextChars: Number(process.env.RETRIEVAL_MAX_CONTEXT_CHARS ?? 9000),
};
