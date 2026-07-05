/**
 * Vector store singleton + boot loader.
 *
 * Owns the one in-memory store instance and the metadata (siteLinks, source URL,
 * pages) of the currently loaded snapshot. On boot it loads the persisted
 * snapshot — but REFUSES incompatible ones (wrong schema version, different
 * embedding model, or mismatched dimensions), warning that a rebuild is needed
 * rather than serving garbage retrievals.
 */
import { config } from '../config/index.js';
import { MemoryVectorStore } from './memoryStore.js';
import { loadSnapshot, saveSnapshot } from './persistence.js';
import type { VectorStore } from './types.js';
import type { KnowledgeSnapshot, PageType } from '../context/types.js';
import type { SiteLink } from '../types.js';

const store: VectorStore = new MemoryVectorStore();

/** Metadata about the currently loaded index (null when empty/fallback). */
export interface LoadedMeta {
  sourceUrl: string;
  siteLinks: SiteLink[];
  pages: Array<{ url: string; path: string; pageType: PageType; contentHash: string; lastCrawled: string }>;
  createdAt: string;
  embeddingModel: string;
}

let loadedMeta: LoadedMeta | null = null;

export function getVectorStore(): VectorStore {
  return store;
}

export function getLoadedMeta(): LoadedMeta | null {
  return loadedMeta;
}

/** Whether a usable RAG index is currently loaded. */
export function knowledgeReady(): boolean {
  return store.size() > 0;
}

/**
 * Load the persisted snapshot into the store. Incompatible snapshots are
 * rejected (store stays empty → callers fall back to static context).
 */
export async function loadOnBoot(): Promise<void> {
  const snap = await loadSnapshot();
  if (!snap) {
    console.log('[knowledge] no snapshot found — running on static fallback until /ingest is run.');
    return;
  }

  const reason = incompatibleReason(snap);
  if (reason) {
    console.warn(`[knowledge] ⚠ ignoring snapshot: ${reason}. A rebuild (/ingest) is required. Using fallback.`);
    return;
  }

  store.import(snap.documents);
  loadedMeta = {
    sourceUrl: snap.sourceUrl,
    siteLinks: snap.siteLinks,
    pages: snap.pages,
    createdAt: snap.createdAt,
    embeddingModel: snap.embeddingModel,
  };
  console.log(
    `[knowledge] loaded snapshot: ${store.size()} chunks from ${snap.sourceUrl} ` +
      `(model ${snap.embeddingModel}, ${store.dimensions()}d, built ${snap.createdAt}).`,
  );
}

/** Persist the current store as a versioned snapshot and update loaded metadata. */
export async function persistSnapshot(meta: Omit<LoadedMeta, 'createdAt' | 'embeddingModel'>): Promise<string> {
  const documents = store.export();
  const snapshot: KnowledgeSnapshot = {
    version: 1,
    embeddingModel: config.gemini.embeddingModel,
    dimensions: store.dimensions(),
    createdAt: new Date().toISOString(),
    sourceUrl: meta.sourceUrl,
    siteLinks: meta.siteLinks,
    pages: meta.pages,
    documents,
  };
  const path = await saveSnapshot(snapshot);
  loadedMeta = { ...meta, createdAt: snapshot.createdAt, embeddingModel: snapshot.embeddingModel };
  return path;
}

/** Return a human reason the snapshot is incompatible, or null if it's fine. */
function incompatibleReason(snap: KnowledgeSnapshot): string | null {
  if (snap.version !== 1) return `unsupported schema version ${snap.version}`;
  if (snap.embeddingModel !== config.gemini.embeddingModel) {
    return `embedding model changed (snapshot=${snap.embeddingModel}, config=${config.gemini.embeddingModel})`;
  }
  const actualDims = snap.documents[0]?.embedding.length ?? 0;
  if (snap.dimensions !== actualDims) {
    return `dimension mismatch (declared ${snap.dimensions}, actual ${actualDims})`;
  }
  return null;
}
