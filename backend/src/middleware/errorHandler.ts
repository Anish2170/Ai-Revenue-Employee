/**
 * Central error handler — last middleware in the chain. Logs the error and
 * returns a generic JSON message (never leaks internals to the widget).
 */
import type { NextFunction, Request, Response } from 'express';
import { UnsafeUrlError } from '../security/ssrf.js';
import { logger } from '../logging/logger.js';

export type SafeErrorCode =
  | 'invalid_request' | 'unauthenticated' | 'forbidden' | 'not_found'
  | 'conflict' | 'payload_too_large' | 'rate_limited' | 'service_unavailable' | 'internal_error';

/** A stable, deliberately small error shape for API consumers. */
export function sendApiError(res: Response, req: Request, status: number, code: SafeErrorCode | string, message: string, extra: Record<string, unknown> = {}): void {
  res.status(status).json({ error: { code, message, requestId: req.requestId }, ...extra });
}

export function notFound(req: Request, res: Response): void {
  sendApiError(res, req, 404, 'not_found', 'The requested resource was not found.');
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const detail = { requestId: req.requestId, method: req.method, path: req.path, error: err };
  if (err instanceof UnsafeUrlError) {
    logger.warn('[error] unsafe_website_url', detail);
    if (!res.headersSent) sendApiError(res, req, 400, 'unsafe_website_url', 'The website URL is not allowed.');
    return;
  }
  if (req.path === '/events') {
    logger.warn('[events] ignored request error', detail);
    if (!res.headersSent) res.status(200).json({ status: 'ignored' });
    return;
  }

  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500;
  const safeStatus = status === 400 || status === 413 ? status : 500;
  const code = safeStatus === 413 ? 'payload_too_large' : safeStatus === 400 ? 'invalid_request' : 'internal_error';
  const safeMessage = safeStatus === 413 ? 'The request is too large.' : safeStatus === 400 ? 'The request could not be processed.' : 'Something went wrong. Please try again.';
  logger.error('[error] unhandled_request_error', detail);
  if (res.headersSent) return;
  sendApiError(res, req, safeStatus, code, safeMessage);
}
