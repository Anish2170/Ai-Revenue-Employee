/**
 * Per-website VectorStore registry — replaces the global singleton.
 *
 * Each website gets its own in-memory store, lazily loaded from its persisted
 * snapshot file (`data/knowledge/<websiteId>.json`). A simple LRU eviction
 * keeps memory bounded when many tenants are active.
 *
 * The old `vectorstore/index.ts` singleton is kept for the dev-fallback tenant
 * (no DB). Production paths use this registry exclusively.
 */
import { config } from '../config/index.js';
import { MemoryVectorStore } from './memoryStore.js';
import { loadSnapshotFile, saveSnapshotFile, websiteSnapshotPath } from './persistence.js';
import type { VectorStore } from './types.js';
import type { KnowledgeSnapshot, PageType } from '../context/types.js';
import type { SiteLink } from '../types.js';

export interface LoadedMeta {
  sourceUrl: string;
  siteLinks: SiteLink[];
  pages: Array<{ url: string; path: string; pageType: PageType; contentHash: string; lastCrawled: string }>;
  createdAt: string;
  embeddingModel: string;
}

interface StoreEntry {
  store: VectorStore;
  meta: LoadedMeta | null;
  lastAccessed: number;
}

const MAX_CACHED_STORES = Number(process.env.MAX_CACHED_STORES ?? 20);
const stores = new Map<string, StoreEntry>();

function evictIfNeeded(): void {
  if (stores.size <= MAX_CACHED_STORES) return;
  let oldest: string | null = null;
  let oldestTime = Infinity;
  for (const [id, entry] of stores) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldest = id;
    }
  }
  if (oldest) {
    stores.delete(oldest);
    console.log(`[registry] evicted store for website ${oldest} (LRU).`);
  }
}

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

/** Get or lazily load the store for a website. */
export async function getWebsiteStore(websiteId: string): Promise<{ store: VectorStore; meta: LoadedMeta | null }> {
  const existing = stores.get(websiteId);
  if (existing) {
    existing.lastAccessed = Date.now();
    return { store: existing.store, meta: existing.meta };
  }

  evictIfNeeded();

  const store = new MemoryVectorStore();
  let meta: LoadedMeta | null = null;

  const snap = await loadSnapshotFile(websiteSnapshotPath(websiteId));
  if (snap) {
    const reason = incompatibleReason(snap);
    if (reason) {
      console.warn(`[registry] ⚠ website ${websiteId}: ignoring snapshot — ${reason}. Rebuild required.`);
    } else {
      store.import(snap.documents);
      meta = {
        sourceUrl: snap.sourceUrl,
        siteLinks: snap.siteLinks,
        pages: snap.pages,
        createdAt: snap.createdAt,
        embeddingModel: snap.embeddingModel,
      };
      console.log(`[registry] loaded ${store.size()} chunks for website ${websiteId}.`);
    }
  }

  stores.set(websiteId, { store, meta, lastAccessed: Date.now() });
  return { store, meta };
}

/** Whether a usable RAG index is loaded for this website. */
export async function knowledgeReadyForWebsite(websiteId: string): Promise<boolean> {
  const { store } = await getWebsiteStore(websiteId);
  return store.size() > 0;
}

/** Persist the store for a website and update its cached metadata. */
export async function persistWebsiteSnapshot(
  websiteId: string,
  meta: Omit<LoadedMeta, 'createdAt' | 'embeddingModel'>,
): Promise<string> {
  const { store } = await getWebsiteStore(websiteId);
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
  const path = await saveSnapshotFile(websiteSnapshotPath(websiteId), snapshot);

  const entry = stores.get(websiteId);
  if (entry) {
    entry.meta = { ...meta, createdAt: snapshot.createdAt, embeddingModel: snapshot.embeddingModel };
    entry.lastAccessed = Date.now();
  }

  return path;
}

/** Force-refresh a website's store (e.g. after ingest rebuilds it). */
export function invalidateWebsiteStore(websiteId: string): void {
  stores.delete(websiteId);
}

/** Get metadata for a website's loaded index (null if not loaded or empty). */
export async function getWebsiteMeta(websiteId: string): Promise<LoadedMeta | null> {
  const { meta } = await getWebsiteStore(websiteId);
  return meta;
}
