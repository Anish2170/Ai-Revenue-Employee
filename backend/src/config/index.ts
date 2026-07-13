/**
 * Centralized runtime configuration, loaded once from the environment.
 * Nothing else in the app should read `process.env` directly.
 */
import 'dotenv/config';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';
const frontendUrl = process.env.FRONTEND_URL ?? process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3001';
const landingPageUrl = process.env.LANDING_PAGE_URL ?? '';
const dashboardOrigin = originFromUrl(process.env.DASHBOARD_ORIGIN) ?? originFromUrl(frontendUrl) ?? 'http://localhost:3001';
const configuredOrigins = Array.from(
  new Set([
    ...csv(process.env.CORS_ORIGIN),
    originFromUrl(frontendUrl),
    originFromUrl(landingPageUrl),
    dashboardOrigin,
  ].filter((origin): origin is string => Boolean(origin))),
);

export const config = {
  nodeEnv: NODE_ENV,
  isProduction,
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  version: process.env.APP_VERSION ?? process.env.RENDER_GIT_COMMIT ?? '0.1.0',

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
    /** Optional explicit Chrome/Edge executable for JS-rendered sites. */
    browserPath: process.env.CRAWL_BROWSER_PATH ?? process.env.CHROME_PATH ?? '',
  },

  /** Database (Postgres). */
  databaseUrl: process.env.DATABASE_URL ?? '',

  /** Auth. */
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret',
  sessionCookieName: 'aire_session',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),

  /** Allowed browser origins. Use a comma-separated allowlist in production. */
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  allowedOrigins: configuredOrigins,
  frontendUrl,
  landingPageUrl,
  /** Dashboard origin allowed to send credentialed (cookie) requests. */
  dashboardOrigin,
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

export function validateProductionConfig(): void {
  if (!config.isProduction) return;

  const missing = [
    ['DATABASE_URL', config.databaseUrl],
    ['GEMINI_API_KEY', config.gemini.apiKey],
    ['SESSION_SECRET', config.sessionSecret],
    ['WIDGET_BASE_URL', config.widgetBaseUrl],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.map(([key]) => key).join(', ')}`);
  }

  if (config.sessionSecret === 'dev-insecure-session-secret' || config.sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be a long random value in production.');
  }

  if (config.corsOrigin === '*' || config.allowedOrigins.includes('*')) {
    throw new Error('CORS_ORIGIN must be a comma-separated allowlist in production; "*" is not allowed.');
  }
}
