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
import { clientIp, hours, minutes, normalizedEmailFromRequest, rateLimit } from '../middleware/rateLimit.js';
import { csrfTokenForSession, requireAuth } from './auth.middleware.js';
import { clearSessionCookie, sessionCookieOptions } from './cookie.js';
import { AuthError, login, logout, signup } from './auth.service.js';
import { prisma } from '../db/prisma.js';

export const authRouter = Router();

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

const signupLimiter = rateLimit([
  { name: 'auth_signup_ip', limit: 5, windowMs: hours(1), key: (req) => clientIp(req) },
]);

const loginLimiter = rateLimit([
  { name: 'auth_login_ip', limit: 10, windowMs: minutes(1), key: (req) => clientIp(req) },
  {
    name: 'auth_login_email_ip',
    limit: 5,
    windowMs: minutes(15),
    key: (req) => {
      const email = normalizedEmailFromRequest(req);
      return email ? `${email}:${clientIp(req)}` : null;
    },
  },
]);

const authRecoveryLimiter = rateLimit([
  { name: 'auth_recovery_ip', limit: 5, windowMs: hours(1), key: (req) => clientIp(req) },
]);

const dashboardAuthLimiter = rateLimit([
  { name: 'dashboard_auth_user', limit: 600, windowMs: minutes(1), key: (req) => req.auth ? `${req.auth.organizationId}:${req.auth.userId}` : null },
]);

authRouter.post('/auth/signup', validateBody(signupSchema), signupLimiter, async (req, res, next) => {
  try {
    const result = await signup({ ...req.body, ip: clientIp(req) });
    res.cookie(config.sessionCookieName, result.token, sessionCookieOptions);
    res.status(201).json({ user: result.user, organization: result.organization, csrfToken: csrfTokenForSession(result.token) });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  }
});

authRouter.post('/auth/login', validateBody(loginSchema), loginLimiter, async (req, res, next) => {
  try {
    const result = await login({ ...req.body, ip: clientIp(req) });
    res.cookie(config.sessionCookieName, result.token, sessionCookieOptions);
    res.json({ user: result.user, organization: result.organization, csrfToken: csrfTokenForSession(result.token) });
  } catch (err) {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  }
});

authRouter.get('/auth/csrf', requireAuth, (req, res) => {
  const token = req.cookies?.[config.sessionCookieName] as string;
  res.json({ csrfToken: csrfTokenForSession(token) });
});

authRouter.post('/auth/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.cookies?.[config.sessionCookieName];
    if (token) await logout(token);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get('/auth/me', requireAuth, dashboardAuthLimiter, async (req, res, next) => {
  try {
    const { userId, organizationId, role } = req.auth!;
    const [user, organization] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } }),
    ]);
    if (!user || !organization) return res.status(401).json({ error: 'unauthenticated' });
    res.json({ user, organization: { ...organization, role } });
  } catch (err) {
    next(err);
  }
});

// Architecture-ready, not implemented this sprint.
authRouter.post('/auth/forgot', authRecoveryLimiter, (_req, res) => res.status(501).json({ error: 'not_implemented' }));
authRouter.post('/auth/reset', authRecoveryLimiter, (_req, res) => res.status(501).json({ error: 'not_implemented' }));
