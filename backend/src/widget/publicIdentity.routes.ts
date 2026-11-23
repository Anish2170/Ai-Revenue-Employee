import { Router } from 'express';
import { z } from 'zod';
import { resolveTenant, TenantDisabledError, TenantNotFoundError } from '../tenant/tenant.resolver.js';
import { issuePublicWidgetIdentity, issueReplayWidgetIdentity } from './publicIdentity.js';
import { currentReplay } from '../popup-replay/runtime.js';
import { prisma } from '../db/prisma.js';

export const publicIdentityRouter = Router();
publicIdentityRouter.post('/widget/session', async (req, res, next) => {
  const parsed = z.object({ siteId: z.string().min(1).max(100), visitorToken: z.string().max(2048).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'INVALID_SITE' });
  try {
    await resolveTenant(parsed.data.siteId);
    const replay = currentReplay();
    const { identity, token } = replay ? issueReplayWidgetIdentity(parsed.data.siteId, replay.runId) : issuePublicWidgetIdentity(parsed.data.siteId, parsed.data.visitorToken);
    if (replay) {
      const bound = await prisma.popupReplayRun.updateMany({ where: { id: replay.runId, sessionId: null, status: 'RUNNING' }, data: { visitorId: identity.visitorId, sessionId: identity.sessionId } });
      if (!bound.count) return res.status(409).json({ error: 'fresh_replay_identity_required' });
    }
    res.status(201).json({ siteId: identity.siteId, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: token, expiresAt: identity.exp });
  } catch (err) {
    if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    next(err);
  }
});
