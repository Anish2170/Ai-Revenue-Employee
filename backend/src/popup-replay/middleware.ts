import type { RequestHandler } from 'express';
import { prisma } from '../db/prisma.js';
import { verifyPublicWidgetIdentity } from '../widget/publicIdentity.js';
import { appendTrace, authorizedRun } from './service.js';
import { replayScope } from './runtime.js';
import { hashableTokenPattern } from './policy.js';

const permitted = new Set(['/widget/session', '/events', '/popup/lifecycle', '/analytics/events']);
/** The signed widget QA claim is unusable without the separate live run lease.
 * No public query parameter or caller-supplied bot flag authorizes a replay. */
export const replayWidgetMiddleware: RequestHandler = async (req, res, next) => {
  const header = req.get('x-popup-replay');
  const identity = typeof req.body?.siteId === 'string' ? verifyPublicWidgetIdentity(req.body.visitorToken, req.body.siteId) : null;
  if (!header && !identity?.replayRunId) return next();
  try {
    if (!header || !permitted.has(req.path) || req.method !== 'POST') return void res.status(403).json({ error: 'replay_scope_required' });
    const [runId, lease, extra] = header.split('.');
    if (extra || !/^[\da-f-]{36}$/i.test(runId) || !hashableTokenPattern.test(lease ?? '')) return void res.status(403).json({ error: 'invalid_replay_scope' });
    const stored = await prisma.popupReplayRun.findUnique({ where: { id: runId }, select: { batch: { select: { runnerId: true, websiteId: true, organizationId: true } } } });
    if (!stored) return void res.status(403).json({ error: 'invalid_replay_scope' });
    const run = await authorizedRun(runId, stored.batch.runnerId, lease);
    const site = await prisma.website.findFirst({ where: { id: stored.batch.websiteId, organizationId: stored.batch.organizationId, deletedAt: null }, include: { widget: true } });
    if (!site?.widget || site.widget.status !== 'ACTIVE' || site.widget.siteId !== req.body.siteId) return void res.status(403).json({ error: 'replay_site_mismatch' });
    if (req.path === '/widget/session') {
      if (run.sessionId || req.body.visitorToken) return void res.status(409).json({ error: 'fresh_replay_identity_required' });
    } else if (!identity || identity.replayRunId !== runId || identity.sessionId !== run.sessionId || identity.visitorId !== run.visitorId || req.body.sessionId !== run.sessionId || req.body.visitorId !== run.visitorId) return void res.status(403).json({ error: 'replay_identity_mismatch' });
    if (req.path === '/analytics/events') {
      await appendTrace(runId, { kind: 'analytics', events: Array.isArray(req.body.events) ? req.body.events.slice(0, 30).map((event: { eventName?: string; category?: string }) => ({ eventName: String(event.eventName ?? '').slice(0, 80), category: String(event.category ?? '').slice(0, 20) })) : [] });
      return void res.json({ status: 'recorded_replay' });
    }
    // Keep only verified, non-secret scope in async execution context.
    replayScope.run({ runId, batchId: run.batchId, runnerId: stored.batch.runnerId, siteId: site.widget.siteId }, () => next());
  } catch { res.status(403).json({ error: 'replay_expired_or_stopped' }); }
};
