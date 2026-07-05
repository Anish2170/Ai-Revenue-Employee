/**
 * RAG retrieval. Turns a request into a search query, embeds it, searches the
 * vector store, and applies Top-K + similarity-threshold + maxContextChars.
 *
 * Sprint 3: accepts an optional `websiteId` to query a per-website store
 * (via the registry). When omitted, falls back to the global dev singleton.
 */
import { retrievalConfig } from '../config/retrieval.js';
import { embedQuery } from '../embeddings/embedder.js';
import { getVectorStore, knowledgeReady } from '../vectorstore/index.js';
import { getWebsiteStore } from '../vectorstore/registry.js';
import type { VectorStore } from '../vectorstore/types.js';
import type { VisitorBehaviour } from '../types.js';
import type { RetrievedChunk } from './types.js';

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  scores: number[];
}

/** Build a retrieval query from the visitor's page/behaviour (engage path). */
export function buildBehaviourQuery(behaviour: VisitorBehaviour): string {
  const parts = [behaviour.pageTitle, behaviour.page, ...behaviour.clickedElements];
  return parts.filter(Boolean).join(' ').slice(0, 400) || 'overview';
}

async function resolveStore(websiteId?: string): Promise<{ store: VectorStore; ready: boolean }> {
  if (websiteId) {
    const { store } = await getWebsiteStore(websiteId);
    return { store, ready: store.size() > 0 };
  }
  return { store: getVectorStore(), ready: knowledgeReady() };
}

/**
 * Retrieve the most relevant chunks for a query.
 * @returns chunks above the similarity threshold, within maxContextChars budget.
 */
export async function retrieve(query: string, websiteId?: string): Promise<RetrievalResult> {
  const { store, ready } = await resolveStore(websiteId);
  if (!ready || !query.trim()) return { chunks: [], scores: [] };

  const queryVec = await embedQuery(query);
  const hits = await store.search(queryVec, retrievalConfig.topK);

  const aboveThreshold = hits.filter((h) => h.score >= retrievalConfig.similarityThreshold);

  // Enforce maxContextChars budget — chunks are already sorted by score desc
  const kept: RetrievedChunk[] = [];
  let charBudget = retrievalConfig.maxContextChars;
  for (const chunk of aboveThreshold) {
    if (chunk.content.length > charBudget) break;
    charBudget -= chunk.content.length;
    kept.push(chunk);
  }

  const allScores = hits.map((h) => Number(h.score.toFixed(3)));
  const keptScores = kept.map((h) => Number(h.score.toFixed(3)));

  console.log(
    `[retrieval] query="${query.slice(0, 60)}" topK=${hits.length} scores=[${allScores.join(', ')}] ` +
      `kept=${kept.length} (threshold ${retrievalConfig.similarityThreshold}, ` +
      `chars ${retrievalConfig.maxContextChars - charBudget}/${retrievalConfig.maxContextChars})` +
      (websiteId ? ` website=${websiteId.slice(0, 8)}` : ''),
  );

  return { chunks: kept, scores: keptScores };
}
