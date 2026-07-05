/**
 * Auth routes: /auth/signup, /auth/login, /auth/logout, /auth/me, and
 * architecture-ready (stubbed) /auth/forgot + /auth/reset.
 *
 * Sessions are delivered as an httpOnly cookie so the dashboard never handles
 * the raw token in JS.
 */
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { validateBody } from '../middleware/validate.js';
import { requireAuth } from './auth.middleware.js';
import { AuthError, login, logout, signup } from './auth.service.js';
import { prisma } from '../db/prisma.js';

export const authRouter = Router();

const cookieOptions = {
  httpOnly: true as const,
  secure: config.isProduction,
  sameSite: (config.isProduction ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  path: '/',
};

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

function clientIp(req: { headers: Record<string, unknown>; ip?: string }): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.ip;
}

authRouter.post('/auth/signup', validateBody(signupSchema), async (req, res, next) => {
  try {
    const result = await signup({ ...req.body, ip: clientIp(req) });
    res.cookie(config.sessionCookieName, result.token, cookieOptions);
    res.status(201).json({ user: result.user, organization: result.organization });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  }
});

authRouter.post('/auth/login', validateBody(loginSchema), async (req, res, next) => {
  try {
    const result = await login({ ...req.body, ip: clientIp(req) });
    res.cookie(config.sessionCookieName, result.token, cookieOptions);
    res.json({ user: result.user, organization: result.organization });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  }
});

authRouter.post('/auth/logout', async (req, res, next) => {
  try {
    const token = req.cookies?.[config.sessionCookieName];
    if (token) await logout(token);
    res.clearCookie(config.sessionCookieName, { ...cookieOptions, maxAge: undefined });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/me', requireAuth, async (req, res, next) => {
  try {
    const { userId, organizationId } = req.auth!;
    const [user, organization] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } }),
    ]);
    if (!user || !organization) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ user, organization });
  } catch (err) {
    next(err);
  }
});

// Architecture-ready, not implemented this sprint.
authRouter.post('/auth/forgot', (_req, res) => res.status(501).json({ error: 'not_implemented' }));
authRouter.post('/auth/reset', (_req, res) => res.status(501).json({ error: 'not_implemented' }));
