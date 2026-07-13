/**
 * Generic zod body-validation middleware factory.
 *
 * On success it replaces req.body with the parsed/coerced value and continues.
 * On failure it responds 400 with a compact error list; no service runs.
 */
import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, infer as ZodInfer } from 'zod';

export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      const message = details
        .map((detail) => `${detail.path ? `${detail.path}: ` : ''}${detail.message}`)
        .join('; ');
      res.status(400).json({
        error: 'invalid_request',
        message: message || 'Invalid request.',
        details,
      });
      return;
    }
    req.body = result.data as ZodInfer<S>;
    next();
  };
}
