import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { hasDatabase } from '../config/index.js';
import { prisma } from '../db/prisma.js';
import { sendApiError } from './errorHandler.js';

type RateLimitKey = string | null | undefined;

export type RateLimitRule = {
  name: string;
  limit: number;
  windowMs: number;
  key: (req: Request) => RateLimitKey | Promise<RateLimitKey>;
};

type RateLimitOptions = {
  onLimited?: '429' | 'ignore';
  ignoredBody?: Record<string, unknown>;
};

type BucketRow = {
  count: number;
};

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let lastCleanupAt = 0;

export const minutes = (value: number) => value * 60 * 1000;
export const hours = (value: number) => value * 60 * 60 * 1000;
export const days = (value: number) => value * 24 * 60 * 60 * 1000;

export function clientIp(req: Request): string {
  const forwardedFor = req.get('x-forwarded-for');
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || req.ip || 'unknown';
  return req.ip || 'unknown';
}

export function siteIdFromRequest(req: Request): string | null {
  const bodySiteId = typeof req.body?.siteId === 'string' ? req.body.siteId.trim() : '';
  if (bodySiteId) return bodySiteId;
  const querySiteId = typeof req.query.siteId === 'string' ? req.query.siteId.trim() : '';
  return querySiteId || null;
}

export function visitorKeyFromRequest(req: Request): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
  const visitorId = typeof body?.visitorId === 'string' ? body.visitorId.trim() : '';
  const querySessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId.trim() : '';
  const queryVisitorId = typeof req.query.visitorId === 'string' ? req.query.visitorId.trim() : '';
  return sessionId || visitorId || querySessionId || queryVisitorId || null;
}

export function normalizedEmailFromRequest(req: Request): string | null {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  return email || null;
}

export function authUserKey(req: Request): string | null {
  const auth = req.auth;
  if (!auth) return null;
  return `${auth.organizationId}:${auth.userId}`;
}

function sanitizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9:._@-]/g, '_').slice(0, 240) || 'unknown';
}

async function incrementBucket(rule: RateLimitRule, rawBucket: string, now: number): Promise<{ count: number; resetAt: number }> {
  const windowStart = Math.floor(now / rule.windowMs) * rule.windowMs;
  const resetAt = windowStart + rule.windowMs;
  const bucket = sanitizeKeyPart(rawBucket);
  const id = `${sanitizeKeyPart(rule.name)}:${bucket}:${windowStart}`;
  const expiresAt = resetAt + rule.windowMs;

  const rows = await prisma.$queryRawUnsafe<BucketRow[]>(
    `
      INSERT INTO "RateLimitBucket" ("id", "limiter", "bucket", "windowStart", "count", "expiresAt", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), 1, to_timestamp($5 / 1000.0), now(), now())
      ON CONFLICT ("id") DO UPDATE
      SET "count" = "RateLimitBucket"."count" + 1,
          "updatedAt" = now()
      RETURNING "count"
    `,
    id,
    rule.name,
    bucket,
    windowStart,
    expiresAt,
  );

  return { count: Number(rows[0]?.count ?? rule.limit + 1), resetAt };
}

function setHeaders(res: Response, rule: RateLimitRule, count: number, resetAt: number): void {
  const remaining = Math.max(0, rule.limit - count);
  res.setHeader('RateLimit-Limit', String(rule.limit));
  res.setHeader('RateLimit-Remaining', String(remaining));
  res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
}

async function cleanupExpiredBuckets(): Promise<void> {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;

  prisma
    .$executeRawUnsafe('DELETE FROM "RateLimitBucket" WHERE "expiresAt" < now()')
    .catch((err) => console.warn('[rate-limit] cleanup failed:', err instanceof Error ? err.message : String(err)));
}

export function rateLimit(rules: RateLimitRule[], options: RateLimitOptions = {}): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!hasDatabase) return next();

    try {
      void cleanupExpiredBuckets();
      const now = Date.now();

      for (const rule of rules) {
        const key = await rule.key(req);
        if (!key) continue;

        const bucket = await incrementBucket(rule, key, now);
        setHeaders(res, rule, bucket.count, bucket.resetAt);

        if (bucket.count > rule.limit) {
          const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
          res.setHeader('Retry-After', String(retryAfter));

          if (options.onLimited === 'ignore') {
            return res.status(200).json(options.ignoredBody ?? { status: 'ignored', reason: 'rate_limited' });
          }

          sendApiError(res, req, 429, 'rate_limited', 'You\'re doing that a little too quickly. Please try again in a moment.', { retryAfterSeconds: retryAfter });
          return;
        }
      }

      return next();
    } catch (err) {
      console.warn('[rate-limit] unavailable:', err instanceof Error ? err.message : String(err));
      sendApiError(res, req, 429, 'rate_limited', 'You\'re doing that a little too quickly. Please try again in a moment.', { retryAfterSeconds: 60 });
      return;
    }
  };
}
