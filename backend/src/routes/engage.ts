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

    const decision = await evaluateEngagement(behaviour, session, { tenant });
    res.json(decision);
  } catch (err) {
    next(err);
  }
});
