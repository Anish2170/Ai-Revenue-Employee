import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logging/logger.js';

declare global { namespace Express { interface Request { requestId?: string } } }

export function requestLogging(req: Request, res: Response, next: NextFunction): void {
  const requestId = randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => logger.info('[http] request_complete', {
    requestId, method: req.method, path: req.path, status: res.statusCode,
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
  }));
  next();
}
