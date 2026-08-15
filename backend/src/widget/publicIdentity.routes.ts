import { Router } from 'express';
import { z } from 'zod';
import { resolveTenant, TenantDisabledError, TenantNotFoundError } from '../tenant/tenant.resolver.js';
import { issuePublicWidgetIdentity } from './publicIdentity.js';

export const publicIdentityRouter = Router();
publicIdentityRouter.post('/widget/session', async (req, res, next) => {
  const parsed = z.object({ siteId: z.string().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_SITE' });
  try {
    await resolveTenant(parsed.data.siteId);
    const { identity, token } = issuePublicWidgetIdentity(parsed.data.siteId);
    res.status(201).json({ siteId: identity.siteId, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: token, expiresAt: identity.exp });
  } catch (err) {
    if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    next(err);
  }
});
