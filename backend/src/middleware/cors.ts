/**
 * CORS configuration.
 *
 * Production allows the configured dashboard/landing origins plus any active
 * website origin stored in the database. That lets newly onboarded widget sites
 * work without editing Render environment variables for every customer.
 */
import cors, { type CorsOptions } from 'cors';
import type { Request } from 'express';
import { config, hasDatabase } from '../config/index.js';
import { prisma } from '../db/prisma.js';

const allowedHeaders = ['Content-Type', 'Authorization', 'X-CSRF-Token'];
const WEBSITE_ORIGIN_CACHE_TTL_MS = 60_000;

let cachedWebsiteOrigins = new Set<string>();
let cacheExpiresAt = 0;

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function getWebsiteOrigins(): Promise<Set<string>> {
  const now = Date.now();
  if (now < cacheExpiresAt) return cachedWebsiteOrigins;

  if (!hasDatabase) {
    cachedWebsiteOrigins = new Set();
    cacheExpiresAt = now + WEBSITE_ORIGIN_CACHE_TTL_MS;
    return cachedWebsiteOrigins;
  }

  try {
    const websites = await prisma.website.findMany({
      where: { deletedAt: null },
      select: { url: true },
    });

    cachedWebsiteOrigins = new Set(
      websites
        .map((website) => normalizeOrigin(website.url))
        .filter((origin): origin is string => Boolean(origin)),
    );
    cacheExpiresAt = now + WEBSITE_ORIGIN_CACHE_TTL_MS;
  } catch (err) {
    console.warn('[cors] failed to refresh website origin cache', err instanceof Error ? err.message : String(err));
    cacheExpiresAt = now + 5_000;
  }

  return cachedWebsiteOrigins;
}

export function isPublicWidgetRequest(path: string): boolean {
  return path === '/widget/session' || path === '/engage' || path === '/events' || path === '/chat' || path === '/ingest' || path === '/debug'
    || path === '/analytics/events' || path === '/conversations' || path.startsWith('/conversations/') || path === '/widget.js';
}

export function corsPolicyFor(
  path: string,
  origin: string | undefined,
  dashboardOrigins: ReadonlySet<string>,
  widgetOrigins: ReadonlySet<string>,
): CorsOptions {
  if (!origin) return { origin: false };

  if (isPublicWidgetRequest(path)) {
    const dashboardTestAiRequest = path === '/widget/session' || path === '/chat';
    return {
      origin: widgetOrigins.has(origin) || (dashboardTestAiRequest && dashboardOrigins.has(origin)),
      credentials: false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders,
    };
  }

  return {
    origin: dashboardOrigins.has(origin),
    credentials: dashboardOrigins.has(origin),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders,
  };
}

export const corsMiddleware = cors((req: Request, callback) => {
  const origin = req.get('origin');
  if (!origin) return callback(null, { origin: false });

  void getWebsiteOrigins()
    .then((websiteOrigins) => callback(null, corsPolicyFor(req.path, origin, new Set(config.dashboardOrigins), websiteOrigins)))
    .catch(callback);
});
