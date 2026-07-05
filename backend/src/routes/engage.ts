/**
 * POST /engage — receive a behaviour snapshot + session counters, return a
 * structured engagement decision. Always responds 200 with a safe decision.
 *
 * Sprint 3: when `siteId` is present in the body AND a database is configured,
 * resolves the tenant and passes it to the engage service for per-website RAG.
 */
import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { engageRequestSchema } from '../validation/requestSchemas.js';
import { evaluateEngagement } from '../services/engageService.js';
import { hasDatabase } from '../config/index.js';
import { resolveTenant, TenantNotFoundError, TenantDisabledError } from '../tenant/tenant.resolver.js';
import type { EngageRequest } from '../validation/requestSchemas.js';

export const engageRouter = Router();

engageRouter.post('/engage', validateBody(engageRequestSchema), async (req, res, next) => {
  try {
    const { siteId, behaviour, session } = req.body as EngageRequest;

    let tenant: { websiteId: string; instructions: import('../context/types.js').BusinessInstructions } | undefined;

    if (siteId && hasDatabase) {
      try {
        const t = await resolveTenant(siteId);
        tenant = { websiteId: t.websiteId, instructions: t.instructions };
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
