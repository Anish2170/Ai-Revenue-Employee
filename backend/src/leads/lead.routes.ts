import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { authUserKey, minutes, rateLimit } from '../middleware/rateLimit.js';
import * as leadService from './lead.service.js';

export const leadRouter = Router();

const dashboardLeadLimiter = rateLimit([
  { name: 'dashboard_leads_user', limit: 600, windowMs: minutes(1), key: authUserKey },
]);

leadRouter.use(requireAuth, dashboardLeadLimiter);

leadRouter.get('/api/leads', async (req, res, next) => {
  try {
    const websiteId = typeof req.query.websiteId === 'string' ? req.query.websiteId : undefined;
    const leads = await leadService.listLeads(req.auth!.organizationId, websiteId);
    res.json(leads);
  } catch (err) {
    next(err);
  }
});
