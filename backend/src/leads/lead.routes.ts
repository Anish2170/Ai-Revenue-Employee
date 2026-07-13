import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import * as leadService from './lead.service.js';

export const leadRouter = Router();

leadRouter.use(requireAuth);

leadRouter.get('/api/leads', async (req, res, next) => {
  try {
    const websiteId = typeof req.query.websiteId === 'string' ? req.query.websiteId : undefined;
    const leads = await leadService.listLeads(req.auth!.organizationId, websiteId);
    res.json(leads);
  } catch (err) {
    next(err);
  }
});