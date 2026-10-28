/**
 * RAG retrieval. Turns a request into a search query, embeds it, searches the
 * vector store, and applies Top-K + similarity-threshold + maxContextChars.
 *
 * Sprint 3: accepts an optional `websiteId` to query a per-website store
 * (via the registry). When omitted, falls back to the global dev singleton.
 */
import { config } from '../config/index.js';
import { retrievalConfig } from '../config/retrieval.js';
import { embedQuery } from '../embeddings/embedder.js';
import { getVectorStore, knowledgeReady } from '../vectorstore/index.js';
import { getWebsiteStore } from '../vectorstore/registry.js';
import type { VectorStore } from '../vectorstore/types.js';
import type { VisitorBehaviour } from '../types.js';
import type { RetrievedChunk } from './types.js';
import { logger } from '../logging/logger.js';
import { abortable, checkCancelled } from '../llm/cancellation.js';
import {planRetrieval,type RetrievalPage,type RetrievalDiagnostics} from './retrievalPlan.js';
import {selectRetrieval} from './retrievalSelection.js';

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  scores: number[];
  diagnostics?: RetrievalDiagnostics;
}

export interface RetrievalOptions {signal?:AbortSignal;deadlineAt?:number;pinnedStore?:VectorStore;sourceUrl?:string;activeVersion?:string;page?:RetrievalPage;history?:string[];purpose?:'chat'|'popup'}

/** Build a retrieval query from the visitor's page/behaviour (engage path). */
export function buildBehaviourQuery(behaviour: VisitorBehaviour): string {
  const parts = [behaviour.pageTitle, behaviour.page, ...behaviour.clickedElements];
  return parts.filter(Boolean).join(' ').slice(0, 400) || 'overview';
}

async function resolveStore(websiteId?: string): Promise<{ store: VectorStore; ready: boolean; sourceUrl?:string; activeVersion?:string }> {
  if (websiteId) {
    const { store,meta } = await getWebsiteStore(websiteId);
    return { store, ready: store.size() > 0,sourceUrl:meta?.sourceUrl,activeVersion:meta?.activeVersion };
  }
  return { store: getVectorStore(), ready: knowledgeReady() };
}

/**
 * Retrieve the most relevant chunks for a query.
 * @returns chunks above the similarity threshold, within maxContextChars budget.
 */
export async function retrieve(query: string, websiteId?: string, options?: RetrievalOptions): Promise<RetrievalResult> {
  checkCancelled(options?.signal);
  const resolved = await abortable(options?.pinnedStore?Promise.resolve({store:options.pinnedStore,ready:options.pinnedStore.size()>0,sourceUrl:options.sourceUrl,activeVersion:options.activeVersion}):resolveStore(websiteId), options?.signal);
  const {store,ready}=resolved;
  if (!ready || !query.trim()) return { chunks: [], scores: [] };

  const metadata=store.export().slice(0,1000).map(({embedding,...chunk})=>({...chunk,score:0}));
  const sourceUrl=options?.sourceUrl??resolved.sourceUrl??metadata.find(chunk=>/^https?:\/\//.test(chunk.url))?.url;
  const plan=planRetrieval(query,metadata,{...options,sourceUrl});
  const queryVec = await embedQuery(plan.searchQuery, options);
  checkCancelled(options?.signal);
  const hits = await abortable(store.search(queryVec,Math.min(1000,Math.max(retrievalConfig.topK,store.size()))), options?.signal);
  const selected=selectRetrieval(hits,plan,{topK:retrievalConfig.topK,threshold:retrievalConfig.similarityThreshold,maxChars:retrievalConfig.maxContextChars,sourceUrl,activeVersion:options?.activeVersion??resolved.activeVersion});
  const kept=selected.chunks;

  const allScores = hits.map((h) => Number(h.score.toFixed(3)));
  const keptScores = kept.map((h) => Number(h.score.toFixed(3)));

  if (config.debugTrace) {
    logger.debug('[retrieval] completed', { topK: hits.length, scores: allScores, kept: kept.length,
      threshold: retrievalConfig.similarityThreshold, contextChars: kept.reduce((n,c)=>n+c.content.length,0),
      maxContextChars: retrievalConfig.maxContextChars, websiteId: websiteId ?? null });
  }

  return selected;
}

