/**
 * POST /engage — receive a behaviour snapshot + session counters, return a
 * structured engagement decision. Always responds 200 with a safe decision.
 *
 * Sprint 3: when `siteId` is present in the body AND a database is configured,
 * resolves the tenant and passes it to the engage service for per-website RAG.
 */
import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { clientIp, hours, minutes, rateLimit, siteIdFromRequest, visitorKeyFromRequest } from '../middleware/rateLimit.js';
import { engageRequestSchema } from '../validation/requestSchemas.js';
import { evaluateEngagement } from '../services/engageService.js';
import { hasDatabase } from '../config/index.js';
import { resolveTenant, TenantNotFoundError, TenantDisabledError } from '../tenant/tenant.resolver.js';
import type { EngageRequest } from '../validation/requestSchemas.js';
import { verifyPublicWidgetRequestIdentity } from '../widget/publicIdentity.js';
import { completePopup, failPopup, reservePopup } from '../intelligence/popupLifecycle.js';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { abortable, deadlineScope } from '../llm/cancellation.js';
import { shouldEvaluate } from '../rules/rulesEngine.js';
import { enqueueAiDecisionLog } from '../analytics/decision-log.service.js';
import { enqueueAnalyticsEvent } from '../analytics/analytics.service.js';

export const engageRouter = Router();

const engageLimiter = rateLimit([
  { name: 'public_engage_ip', limit: 120, windowMs: minutes(1), key: (req) => clientIp(req) },
  { name: 'public_engage_site', limit: 2000, windowMs: hours(1), key: siteIdFromRequest },
  {
    name: 'public_engage_site_session',
    limit: 60,
    windowMs: minutes(1),
    key: (req) => {
      const siteId = siteIdFromRequest(req);
      const visitor = visitorKeyFromRequest(req);
      return siteId && visitor ? `${siteId}:${visitor}` : null;
    },
  },
]);

engageRouter.post('/engage', engageLimiter, validateBody(engageRequestSchema), async (req, res, next) => {
  try {
    const body = req.body as EngageRequest;
    if (!verifyPublicWidgetRequestIdentity(body)) {
      return res.status(403).json({ error: 'INVALID_WIDGET_SESSION' });
    }
    const { siteId, behaviour, session } = body;

    let tenant: { websiteId: string; instructions: import('../context/types.js').BusinessInstructions; businessActions?: import('../business-actions/action.types.js').BusinessActionConfig[] } | undefined;

    if (hasDatabase) {
      try {
        const t = await resolveTenant(siteId);
        tenant = { websiteId: t.websiteId, instructions: t.instructions, businessActions: t.businessActions };
      } catch (err) {
        if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) {
          return res.json({ showPopup: false });
        }
        throw err;
      }
    }

    const safety = body.clientState?.safety;
    if (body.lifecycleVersion !== 2 || !body.pageInstanceId || !safety) return res.json({ showPopup: false });
    if (safety.blockedReason || safety.formStalled || body.clientState?.chatOpen || body.clientState?.popupActive || !shouldEvaluate(behaviour, session).proceed) return res.json({ showPopup: false });
    const visitor = sessionStore.getOrCreate(body.sessionId, { siteId, returning: false });
    if (session.dismissed) sessionStore.markDismissed(body.sessionId);
    const context = { pageInstanceId: body.pageInstanceId, pageStartedAt: body.pageStartedAt ?? 0, ...safety };
    const { candidate } = reservePopup(visitor, context, visitor.latestEventTs ?? 0);
    if (!candidate) return res.json({ showPopup: false });
    const scope = deadlineScope(candidate.controller.signal, 12_000);
    const disconnected = () => { if (!res.writableEnded) candidate.controller.abort(new Error('Widget disconnected')); };
    res.once('close', disconnected);
    try {
      const decision = await abortable(evaluateEngagement(behaviour, session, { tenant, signal: scope.signal, deadlineAt: Date.now() + 12_000 }), scope.signal);
      if (!decision.showPopup || !completePopup(visitor, candidate)) { failPopup(visitor, candidate); return res.json({ showPopup: false }); }
      const resolvedTenant = hasDatabase ? await resolveTenant(siteId) : null;
      const analyticsTenant = resolvedTenant ? { organizationId: resolvedTenant.organizationId, websiteId: resolvedTenant.websiteId } : null;
      enqueueAiDecisionLog(analyticsTenant, { id: candidate.id, sessionId: body.sessionId, visitorId: body.visitorId, pagePath: behaviour.page, decision: 'Popup Generated', popupGenerated: true, finalOutcome: 'Generated', llmUsed: true, validationPassed: true });
      enqueueAnalyticsEvent(analyticsTenant, { sessionId: body.sessionId, visitorId: body.visitorId }, { category: 'POPUP', eventName: 'popup_generated', eventId: `${candidate.id}:generated`, decisionId: candidate.id });
      return res.json({ ...decision, delivery: { version: 2, popupId: candidate.id, decisionId: candidate.id, pageInstanceId: candidate.pageInstanceId, contextVersion: candidate.contextVersion, expiresAt: candidate.expiresAt, formAssistance: false } });
    } catch { failPopup(visitor, candidate); return res.json({ showPopup: false }); }
    finally { scope.close(); res.removeListener('close', disconnected); }
  } catch (err) {
    next(err);
  }
});
