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

const optionalText = (max: number) => z.string().max(max).optional();
const optionalNonEmptyText = (max: number) => z.string().trim().min(1).max(max).optional();

const updateSchema = z.object({
  businessName: optionalNonEmptyText(120),
  companyDescription: optionalText(5000),
  role: optionalText(5000),
  tone: optionalText(2000),
  goal: optionalText(5000),
  context: optionalText(10000),
  rules: optionalText(10000),
  fallbackMessage: optionalText(2000),
  language: optionalNonEmptyText(40),
  alwaysBookDemo: z.boolean().optional(),
  avoidDiscounts: z.boolean().optional(),
  allowedLinks: z.array(z.object({ label: z.string(), url: z.string().url() })).optional(),
  preferredCta: optionalText(2000),
  supportEmail: optionalText(254),
  supportPhone: optionalText(100),
  websiteUrl: optionalText(2048),
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
