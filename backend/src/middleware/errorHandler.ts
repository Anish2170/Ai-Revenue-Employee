/**
 * Central error handler — last middleware in the chain. Logs the error and
 * returns a generic JSON message (never leaks internals to the widget).
 */
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'not_found' });
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (req.path === '/events') {
    console.warn('[events] ignored request error:', message);
    if (!res.headersSent) res.status(200).json({ status: 'ignored' });
    return;
  }

  console.error('[error]', message);
  if (res.headersSent) return;
  res.status(500).json({
    error: 'internal_error',
    ...(config.isProduction ? {} : { message }),
  });
}
