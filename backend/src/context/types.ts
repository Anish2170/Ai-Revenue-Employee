/**
 * Shared knowledge-engine types (Sprint 2 RAG foundation).
 *
 * These describe the data flowing through crawl → chunk → embed → store →
 * retrieve → context. Many fields (hashes, timestamps, pageType, language) are
 * populated now but only *used* by future sprints (incremental crawling,
 * filtered/multi-lang retrieval) — they exist so those features need no schema
 * change.
 */
import type { SiteLink } from '../types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import type { DiscoveredActionGraph } from '../business-actions/discovered-action.types.js';

/** Coarse classification of a crawled page, from its URL/path. */
export type PageType =
  | 'home'
  | 'about'
  | 'services'
  | 'pricing'
  | 'faq'
  | 'contact'
  | 'blog'
  | 'case-study'
  | 'other';

/** One crawled page after clean-text extraction. */
export interface CrawledPage {
  url: string;
  /** Path portion, e.g. "/pricing". */
  path: string;
  title: string;
  text: string;
  pageType: PageType;
  /** SHA-256 of the NORMALIZED extracted text (stable across deploys) — incremental-ready. */
  contentHash: string;
  /** ISO timestamp of when this page was crawled. */
  lastCrawled: string;
}

/** Metadata attached to every chunk (ready for filtering / multi-lang / incremental). */
export interface ChunkMetadata {
  id: string;
  /** Page path the chunk came from. */
  page: string;
  url: string;
  pageType: PageType;
  /** Normalized section slug. */
  section: string;
  /** Nearest heading text. */
  heading: string;
  /** Page title. */
  title: string;
  /** Language tag; sourced from business instructions for now (no per-chunk detection yet). */
  language: string;
  /** SHA-256 of the chunk content (future chunk-level diffing). */
  hash: string;
  lastCrawled: string;
}

/** A chunk of page text plus its metadata. */
export interface Chunk extends ChunkMetadata {
  content: string;
}

/** A chunk with its embedding vector. */
export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

/** A chunk returned from retrieval, with its similarity score. */
export interface RetrievedChunk extends ChunkMetadata {
  content: string;
  score: number;
}

/** Owner-defined AI behaviour (Sprint 2: local JSON; later: dashboard). */
export interface BusinessInstructions {
  businessName: string;
  companyDescription?: string;
  role?: string;
  tone: string;
  goal?: string;
  context?: string;
  rules?: string;
  fallbackMessage?: string;
  alwaysBookDemo: boolean;
  avoidDiscounts: boolean;
  language: string;
  websiteUrl?: string;
}

/**
 * The single object every service receives from the Context Provider. Callers
 * never touch the vector store, chunks, or instructions directly.
 */
export interface ResolvedContext {
  business: { name: string; description?: string };
  instructions: BusinessInstructions;
  /** Top-K, threshold-filtered, relevant chunks only. */
  chunks: RetrievedChunk[];
  /** Navigable links (from crawl, or static on fallback). */
  siteLinks: SiteLink[];
  /** Enabled, business-configured actions the AI may choose by Action ID. */
  businessActions: BusinessActionConfig[];
  /** Whether real RAG was used or the static fallback. */
  source: 'rag' | 'fallback';
  /** Similarity scores of the retrieved chunks (debug/tuning). */
  scores: number[];
}

/**
 * Versioned on-disk snapshot envelope. The version/embeddingModel/dimensions
 * let the loader refuse incompatible vectors instead of silently serving bad
 * retrievals.
 */
export interface KnowledgeSnapshot {
  version: 1;
  embeddingModel: string;
  dimensions: number;
  createdAt: string;
  sourceUrl: string;
  /** Navigable links derived from the crawl (persisted so boot has them without re-crawling). */
  siteLinks: SiteLink[];
  /** Per-page hashes/timestamps — future incremental "skip unchanged page". */
  pages: Array<{ url: string; path: string; pageType: PageType; contentHash: string; lastCrawled: string }>;
  /** Developer-only debug payload captured during ingestion. Older snapshots omit this field. */
  debugPages?: Array<{
    url: string;
    path: string;
    title: string;
    crawlStatus: 'crawled' | 'skipped';
    httpStatus: number | null;
    rawExtractedText: string;
    cleanedText: string;
    extractedTextLength: number;
    cleanedTextLength: number;
    wordCount: number;
    chunkCount: number;
    lastCrawled: string;
    renderer: 'static' | 'js-rendered' | 'unknown';
    cleaning: {
      removedNavigation: boolean;
      removedFooter: boolean;
      removedScripts: boolean;
      removedCookieBanners: boolean;
      removedDuplicatedContent: boolean;
      beforeLength: number;
      afterLength: number;
      notes: string[];
    };
  }>;
  /** Crawl-discovered intent -> URL action graph. Manual business actions are no longer required. */
  actionGraph?: DiscoveredActionGraph;
  documents: EmbeddedChunk[];
}

