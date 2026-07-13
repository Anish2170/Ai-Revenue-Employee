/**
 * CORS configuration.
 *
 * Production allows the configured dashboard/landing origins plus any active
 * website origin stored in the database. That lets newly onboarded widget sites
 * work without editing Render environment variables for every customer.
 */
import cors from 'cors';
import { config, hasDatabase } from '../config/index.js';
import { prisma } from '../db/prisma.js';

const allowedHeaders = ['Content-Type', 'Authorization'];
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

async function isAllowedOrigin(origin: string): Promise<boolean> {
  if (config.allowedOrigins.includes(origin)) return true;
  const websiteOrigins = await getWebsiteOrigins();
  return websiteOrigins.has(origin);
}

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (!config.isProduction && config.corsOrigin === '*') {
      return callback(null, true);
    }

    void isAllowedOrigin(origin)
      .then((allowed) => callback(null, allowed))
      .catch((err) => callback(err, false));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders,
});
