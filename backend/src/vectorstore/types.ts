/**
 * Provider-agnostic vector store port.
 *
 * The rest of the app never knows how vectors are stored. Sprint 2 ships an
 * in-memory cosine implementation; Pinecone / Qdrant / pgvector can drop in
 * later by implementing this same interface — no application changes.
 */
import type { EmbeddedChunk, RetrievedChunk } from '../context/types.js';

export interface VectorStore {
  /** Replace the entire index with these documents (full rebuild, Sprint 2). */
  indexDocuments(docs: EmbeddedChunk[]): Promise<void>;

  /**
   * Return the `topK` nearest documents to `queryEmbedding`, with similarity
   * scores, sorted descending. Threshold filtering is the caller's concern.
   */
  search(queryEmbedding: number[], topK: number): Promise<RetrievedChunk[]>;

  /** Remove documents by id, or clear everything when no ids are given. */
  delete(ids?: string[]): Promise<void>;

  /** Number of indexed documents. */
  size(): number;

  /** Vector dimensionality of the current index (0 when empty). */
  dimensions(): number;

  /** Export all stored documents (for persistence). */
  export(): EmbeddedChunk[];

  /** Replace contents from a previously exported document set. */
  import(docs: EmbeddedChunk[]): void;
}
