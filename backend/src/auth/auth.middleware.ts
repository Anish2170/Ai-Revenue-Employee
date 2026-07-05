/**
 * requireAuth — gate for private (dashboard) routes.
 *
 * Reads the session cookie, resolves it to a live session, and attaches
 * `req.auth = { userId, organizationId }`. Missing/invalid → 401. All tenant
 * ownership checks downstream use `req.auth.organizationId`, never a client id.
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { resolveSession } from './auth.service.js';

/** Auth context attached to authenticated requests. */
export interface AuthContext {
  userId: string;
  organizationId: string;
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
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  const auth = await resolveSession(token);
  if (!auth) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  req.auth = auth;
  next();
}
