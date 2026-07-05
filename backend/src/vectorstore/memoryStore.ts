/**
 * In-memory vector store with cosine-similarity search.
 *
 * Vectors are L2-normalized on insert, so similarity reduces to a dot product
 * at query time (fast, and cosine == dot for unit vectors). Adequate for the
 * Sprint 2 scale (tens–hundreds of chunks); swap for a real ANN index later via
 * the {@link VectorStore} port.
 */
import type { EmbeddedChunk, RetrievedChunk } from '../context/types.js';
import type { VectorStore } from './types.js';

interface StoredDoc {
  chunk: EmbeddedChunk;
  /** L2-normalized embedding for fast cosine via dot product. */
  unit: number[];
}

function normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const mag = Math.sqrt(sumSq);
  if (mag === 0) return vec.slice();
  return vec.map((v) => v / mag);
}

function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) s += a[i] * b[i];
  return s;
}

export class MemoryVectorStore implements VectorStore {
  private docs: StoredDoc[] = [];

  async indexDocuments(docs: EmbeddedChunk[]): Promise<void> {
    // Sprint 2 = full rebuild.
    this.import(docs);
  }

  async search(queryEmbedding: number[], topK: number): Promise<RetrievedChunk[]> {
    if (this.docs.length === 0 || queryEmbedding.length === 0) return [];
    const q = normalize(queryEmbedding);

    const scored = this.docs.map((d) => ({ d, score: dot(q, d.unit) }));
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, Math.max(0, topK)).map(({ d, score }) => {
      const { embedding: _embedding, ...meta } = d.chunk;
      return { ...meta, score };
    });
  }

  async delete(ids?: string[]): Promise<void> {
    if (!ids) {
      this.docs = [];
      return;
    }
    const remove = new Set(ids);
    this.docs = this.docs.filter((d) => !remove.has(d.chunk.id));
  }

  size(): number {
    return this.docs.length;
  }

  dimensions(): number {
    return this.docs[0]?.chunk.embedding.length ?? 0;
  }

  export(): EmbeddedChunk[] {
    return this.docs.map((d) => d.chunk);
  }

  import(docs: EmbeddedChunk[]): void {
    this.docs = docs.map((chunk) => ({ chunk, unit: normalize(chunk.embedding) }));
  }
}
