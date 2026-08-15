/**
 * Centralized runtime configuration, loaded once from the environment.
 * Nothing else in the app should read `process.env` directly.
 */
import 'dotenv/config';
import { registerSensitiveValues } from '../logging/sanitize.js';

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
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const isProduction = NODE_ENV === 'production';
const configuredFrontendUrl = process.env.FRONTEND_URL;
const configuredLandingPageUrl = process.env.LANDING_PAGE_URL;
const configuredDashboardOrigin = process.env.DASHBOARD_ORIGIN;
const configuredCorsOrigin = process.env.CORS_ORIGIN;
const configuredWidgetBaseUrl = process.env.WIDGET_BASE_URL;
const configuredKnowledgeStorage = process.env.KNOWLEDGE_STORAGE;
const frontendUrl = configuredFrontendUrl ?? configuredDashboardOrigin ?? 'http://localhost:3001';
const landingPageUrl = configuredLandingPageUrl ?? '';
const dashboardOrigin = originFromUrl(configuredDashboardOrigin) ?? originFromUrl(frontendUrl) ?? 'http://localhost:3001';
const dashboardOrigins = Array.from(
  new Set([
    ...csv(configuredCorsOrigin).map(originFromUrl),
    originFromUrl(frontendUrl),
    originFromUrl(landingPageUrl),
    dashboardOrigin,
  ].filter((origin): origin is string => Boolean(origin))),
);
const knowledgeStorage = configuredKnowledgeStorage === 'r2' ? 'r2' : 'local';

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

  llm: {
    primary: {
      provider: process.env.PRIMARY_LLM_PROVIDER ?? 'openai',
      model: process.env.PRIMARY_LLM_MODEL ?? 'gpt-5-mini',
      apiKey: process.env.OPENAI_API_KEY ?? '',
    },
    fallback: {
      provider: process.env.FALLBACK_LLM_PROVIDER ?? 'gemini',
      model: process.env.FALLBACK_LLM_MODEL ?? 'gemini-2.5-flash',
    },
    connectionTimeoutMs: Math.max(1_000, Number(process.env.LLM_CONNECTION_TIMEOUT_MS ?? 10_000)),
    responseTimeoutMs: Math.max(5_000, Number(process.env.LLM_RESPONSE_TIMEOUT_MS ?? 45_000)),
    streamInactivityTimeoutMs: Math.max(5_000, Number(process.env.LLM_STREAM_INACTIVITY_TIMEOUT_MS ?? 20_000)),
    primaryRetries: Math.min(2, Math.max(0, Number(process.env.LLM_PRIMARY_RETRIES ?? 1))),
  },

  /**
   * Directory (relative to backend/) holding per-website snapshots:
   * data/knowledge/<websiteId>.json. Sprint 2's single-file default is kept as a
   * back-compat fallback path for the dev-fallback tenant.
   */
  knowledgeDir: process.env.KNOWLEDGE_DIR ?? 'data/knowledge',
  legacySnapshotPath: process.env.KNOWLEDGE_SNAPSHOT_PATH ?? 'data/knowledge-index.json',
  knowledgeStorage,
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? '',
    bucket: process.env.R2_BUCKET ?? '',
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    endpoint: process.env.R2_ENDPOINT ?? '',
    region: process.env.R2_REGION ?? 'auto',
  },

  /** Crawler limits. */
  crawl: {
    maxPages: Number(process.env.CRAWL_MAX_PAGES ?? 25),
    concurrency: Number(process.env.CRAWL_CONCURRENCY ?? 4),
    timeoutMs: Number(process.env.CRAWL_TIMEOUT_MS ?? 12000),
    /** Optional explicit Chrome/Edge executable for JS-rendered sites. */
    browserPath: process.env.CRAWL_BROWSER_PATH ?? process.env.CHROME_PATH ?? '',
  },

  knowledgeWorker: {
    concurrency: Math.max(1, Number(process.env.KNOWLEDGE_WORKER_CONCURRENCY ?? 1)),
    pollMs: Math.max(500, Number(process.env.KNOWLEDGE_WORKER_POLL_MS ?? 2000)),
    leaseMs: Math.max(30_000, Number(process.env.KNOWLEDGE_BUILD_LEASE_MS ?? 120_000)),
  },

  /** Database (Postgres). */
  databaseUrl: process.env.DATABASE_URL ?? '',

  /** Auth. */
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret',
  sessionCookieName: 'aire_session',
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS ?? 30),

  /** Legacy dashboard/frontend CORS allowlist. Customer website origins are resolved separately. */
  corsOrigin: configuredCorsOrigin ?? '*',
  dashboardOrigins,
  frontendUrl,
  landingPageUrl,
  /** Dashboard origin allowed to send credentialed (cookie) requests. */
  dashboardOrigin,
  /** Public base URL the widget is served from (used in generated snippets). */
  widgetBaseUrl: configuredWidgetBaseUrl ?? 'http://localhost:8787',

  /**
   * Whether to attach the dev-only decision trace to /engage responses.
   * Defaults to on outside production; DEBUG_TRACE overrides explicitly.
   */
  debugTrace: bool(process.env.DEBUG_TRACE, !isProduction),
} as const;

registerSensitiveValues([
  config.gemini.apiKey, config.llm.primary.apiKey, config.r2.accessKeyId, config.r2.secretAccessKey,
  config.databaseUrl, config.sessionSecret,
]);

/** True when an LLM provider is actually configured. */
export const hasLLM = config.llm.primary.apiKey.length > 0 && config.gemini.apiKey.length > 0;

/** True when a database is configured (enables SaaS/multi-tenant features). */
export const hasDatabase = config.databaseUrl.length > 0;

export function validateProductionConfig(): void {
  if (!config.isProduction) return;

  const missing = [
    ['DATABASE_URL', config.databaseUrl],
    ['SESSION_SECRET', config.sessionSecret],
    ['FRONTEND_URL', configuredFrontendUrl],
    ['DASHBOARD_ORIGIN', configuredDashboardOrigin],
    ['WIDGET_BASE_URL', configuredWidgetBaseUrl],
    ['CORS_ORIGIN', configuredCorsOrigin],
  ].filter(([, value]) => !value);

  if (config.llm.primary.provider === 'openai') missing.push(['OPENAI_API_KEY', config.llm.primary.apiKey]);
  if (config.llm.fallback.provider === 'gemini' || config.gemini.embeddingModel) missing.push(['GEMINI_API_KEY', config.gemini.apiKey]);

  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.map(([key]) => key).join(', ')}`);
  }

  if (config.sessionSecret === 'dev-insecure-session-secret' || config.sessionSecret.trim().length < 32 || /^(.)\1+$/.test(config.sessionSecret)) {
    throw new Error('SESSION_SECRET must be a long random value in production.');
  }

  const invalid = [
    ['FRONTEND_URL', configuredFrontendUrl, originFromUrl(configuredFrontendUrl)],
    ['DASHBOARD_ORIGIN', configuredDashboardOrigin, originFromUrl(configuredDashboardOrigin)],
    ['WIDGET_BASE_URL', configuredWidgetBaseUrl, originFromUrl(configuredWidgetBaseUrl)],
  ].filter(([, raw, origin]) => Boolean(raw) && !origin).map(([key]) => key);
  const corsEntries = csv(configuredCorsOrigin);
  if (corsEntries.length === 0 || corsEntries.includes('*') || corsEntries.some((origin) => !originFromUrl(origin))) invalid.push('CORS_ORIGIN');
  if (invalid.length > 0) {
    throw new Error(`Invalid production environment variables: ${Array.from(new Set(invalid)).join(', ')}. Use explicit http(s) origins; CORS_ORIGIN cannot contain "*".`);
  }

  if (config.llm.primary.provider !== 'openai') {
    throw new Error('Invalid PRIMARY_LLM_PROVIDER in production. Supported value: openai.');
  }
  if (config.llm.fallback.provider !== 'gemini') {
    throw new Error('Invalid FALLBACK_LLM_PROVIDER in production. Supported value: gemini.');
  }
  if (!config.llm.primary.model) throw new Error('PRIMARY_LLM_MODEL is required in production.');
  if (!config.llm.fallback.model) throw new Error('FALLBACK_LLM_MODEL is required in production.');
  if (configuredKnowledgeStorage && configuredKnowledgeStorage !== 'local' && configuredKnowledgeStorage !== 'r2') {
    throw new Error('Invalid KNOWLEDGE_STORAGE in production. Supported values: local, r2.');
  }

  if (config.knowledgeStorage === 'r2') {
    const missingR2 = [
      ['R2_ACCOUNT_ID', config.r2.accountId], ['R2_BUCKET', config.r2.bucket],
      ['R2_ACCESS_KEY_ID', config.r2.accessKeyId], ['R2_SECRET_ACCESS_KEY', config.r2.secretAccessKey],
      ['R2_ENDPOINT', config.r2.endpoint],
    ].filter(([, value]) => !value);
    if (missingR2.length > 0) throw new Error(`Missing R2 configuration: ${missingR2.map(([key]) => key).join(', ')}`);
    try {
      const endpoint = new URL(config.r2.endpoint);
      if (endpoint.protocol !== 'https:') throw new Error('not_https');
    } catch {
      throw new Error('Invalid R2_ENDPOINT in production. Use the HTTPS Cloudflare R2 endpoint.');
    }
  }
}
