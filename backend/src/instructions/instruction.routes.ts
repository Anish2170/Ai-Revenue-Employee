/**
 * Business instruction routes: /api/websites/:id/instructions
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { OwnershipError } from '../websites/website.service.js';
import * as instructionService from './instruction.service.js';

export const instructionRouter = Router();

const updateSchema = z.object({
  businessName: z.string().min(1).max(120).optional(),
  companyDescription: z.string().max(1000).optional(),
  role: z.string().max(500).optional(),
  tone: z.string().max(200).optional(),
  goal: z.string().max(500).optional(),
  context: z.string().max(2000).optional(),
  rules: z.string().max(2000).optional(),
  fallbackMessage: z.string().max(500).optional(),
  language: z.string().max(40).optional(),
  alwaysBookDemo: z.boolean().optional(),
  avoidDiscounts: z.boolean().optional(),
  allowedLinks: z.array(z.object({ label: z.string(), url: z.string().url() })).optional(),
  preferredCta: z.string().max(200).optional(),
  supportEmail: z.string().email().optional(),
  supportPhone: z.string().max(40).optional(),
  websiteUrl: z.string().url().optional(),
});

instructionRouter.use(requireAuth);

instructionRouter.get('/api/websites/:id/instructions', async (req, res, next) => {
  try {
    const instructions = await instructionService.getOrCreateInstructions(req.auth!.organizationId, req.params.id);
    res.json(instructions);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

instructionRouter.put('/api/websites/:id/instructions', validateBody(updateSchema), async (req, res, next) => {
  try {
    const updated = await instructionService.updateInstructions(
      req.auth!.organizationId,
      req.auth!.userId,
      req.params.id,
      req.body,
    );
    res.json(updated);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
