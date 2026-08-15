/** Central authorization policy for dashboard requests. */
import type { MemberRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';

export const PRIVILEGED_DASHBOARD_ROLES: readonly MemberRole[] = ['OWNER', 'ADMIN'];

function unauthenticated(res: Response): void {
  res.status(401).json({ error: 'unauthenticated' });
}

/** Require the active membership already resolved by `requireAuth`. */
export function requireActiveMembership(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) return unauthenticated(res);
  next();
}

/** Require one of the supplied organization roles without disclosing tenant details. */
export function requireRole(...roles: readonly MemberRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) return unauthenticated(res);
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

export const requirePrivilegedDashboardRole = requireRole(...PRIVILEGED_DASHBOARD_ROLES);
