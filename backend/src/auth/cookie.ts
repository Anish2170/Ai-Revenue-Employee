import type { Response } from 'express';
import { config } from '../config/index.js';

export const sessionCookieOptions = {
  httpOnly: true as const,
  secure: config.isProduction,
  sameSite: (config.isProduction ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: config.sessionTtlDays * 24 * 60 * 60 * 1000,
  path: '/',
};

/** Clear a stale or invalid dashboard session using the same cookie scope. */
export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, { ...sessionCookieOptions, maxAge: undefined });
}
