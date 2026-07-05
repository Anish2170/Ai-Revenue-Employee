/**
 * Centralized runtime configuration, loaded once from the environment.
 * Nothing else in the app should read `process.env` directly.
 */
import 'dotenv/config';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: Number(process.env.PORT ?? 8787),

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    /** Embedding model for the RAG knowledge engine. */
    embeddingModel: process.env.EMBEDDING_MODEL ?? 'gemini-embedding-001',
  },

  /**
   * Directory (relative to backend/) holding per-website snapshots:
   * data/knowledge/<websiteId>.json. Sprint 2's single-file default is kept as a
   * back-compat fallback path for the dev-fallback tenant.
   */
  knowledgeDir: process.env.KNOWLEDGE_DIR ?? 'data/knowledge',
  legacySnapshotPath: process.env.KNOWLEDGE_SNAPSHOT_PATH ?? 'data/knowledge-index.json',

  /** Crawler limits. */
  crawl: {
    maxPages: Number(process.env.CRAWL_MAX_PAGES ?? 25),
    concurrency: Number(process.env.CRAWL_CONCURRENCY ?? 4),
    timeoutMs: Number(process.env.CRAWL_TIMEOUT_MS ?? 12000),
  },

  /** Database (Neon Postgres). */
  databaseUrl: process.env.DATABASE_URL ?? '',

  /** Auth. */
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret',
  sessionCookieName: 'aire_session',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),

  /** Allowed CORS origins. "*" (default) allows any — the widget embeds cross-origin. */
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  /** Dashboard origin allowed to send credentialed (cookie) requests. */
  dashboardOrigin: process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3001',
  /** Public base URL the widget is served from (used in generated snippets). */
  widgetBaseUrl: process.env.WIDGET_BASE_URL ?? 'http://localhost:8787',

  /**
   * Whether to attach the dev-only decision trace to /engage responses.
   * Defaults to on outside production; DEBUG_TRACE overrides explicitly.
   */
  debugTrace: bool(process.env.DEBUG_TRACE, !isProduction),
} as const;

/** True when an LLM provider is actually configured. */
export const hasLLM = config.gemini.apiKey.length > 0;

/** True when a database is configured (enables SaaS/multi-tenant features). */
export const hasDatabase = config.databaseUrl.length > 0;
