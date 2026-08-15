/**
 * requireAuth — gate for private (dashboard) routes.
 *
 * Reads the session cookie, resolves it to a live session, and attaches
 * `req.auth = { userId, organizationId }`. Missing/invalid → 401. All tenant
 * ownership checks downstream use `req.auth.organizationId`, never a client id.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { MemberRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { clearSessionCookie } from './cookie.js';
import { resolveSession } from './auth.service.js';
import { sendApiError } from '../middleware/errorHandler.js';

/** Auth context attached to authenticated requests. */
export interface AuthContext {
  userId: string;
  organizationId: string;
  role: MemberRole;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originFromHeader(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isAllowedDashboardOrigin(req: Request): boolean {
  const origin = originFromHeader(req.get('origin')) ?? originFromHeader(req.get('referer'));
  return Boolean(origin && config.dashboardOrigins.includes(origin));
}

export function csrfTokenForSession(sessionToken: string): string {
  return createHmac('sha256', config.sessionSecret).update(sessionToken).digest('base64url');
}

function hasValidCsrfToken(req: Request, sessionToken: string): boolean {
  const supplied = req.get('x-csrf-token');
  if (!supplied) return false;
  const expected = csrfTokenForSession(sessionToken);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function requireCsrfForDashboardMutation(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!isAllowedDashboardOrigin(req)) {
    sendApiError(res, req, 403, 'forbidden', 'This action is not allowed from this origin.');
    return;
  }
  const token = req.cookies?.[config.sessionCookieName];
  if (!token || !hasValidCsrfToken(req, token)) {
    sendApiError(res, req, 403, 'forbidden', 'This action could not be verified. Refresh the page and try again.');
    return;
  }
  next();
}

// Augment Express's Request with our auth context.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[config.sessionCookieName];
  if (!token) {
    sendApiError(res, req, 401, 'unauthenticated', 'Please sign in to continue.');
    return;
  }
  const auth = await resolveSession(token);
  if (!auth) {
    clearSessionCookie(res);
    sendApiError(res, req, 401, 'unauthenticated', 'Please sign in to continue.');
    return;
  }
  req.auth = auth;
  requireCsrfForDashboardMutation(req, res, next);
}
