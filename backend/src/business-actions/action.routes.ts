import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { OwnershipError } from '../websites/website.service.js';
import { BUSINESS_ACTION_DESTINATION_TYPES } from './action.types.js';
import * as actionService from './action.service.js';

export const businessActionRouter = Router();

const actionIdParamSchema = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);

const createActionSchema = z.object({
  actionId: actionIdParamSchema,
  label: z.string().min(1).max(80),
  destinationType: z.enum(BUSINESS_ACTION_DESTINATION_TYPES),
  destination: z.string().max(2048).default(''),
  enabled: z.boolean().default(false),
});

const updateActionSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  destinationType: z.enum(BUSINESS_ACTION_DESTINATION_TYPES).optional(),
  destination: z.string().max(2048).optional(),
  enabled: z.boolean().optional(),
});

const overrideSchema = z.object({
  url: z.string().min(1).max(2048),
});

businessActionRouter.use(requireAuth);

businessActionRouter.get('/api/websites/:id/actions', async (req, res, next) => {
  try {
    const actions = await actionService.listBusinessActions(req.auth!.organizationId, req.params.id);
    res.json({ actions });
  } catch (err) {
    if (err instanceof OwnershipError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  }
});


businessActionRouter.get('/api/websites/:id/actions/discovered', async (req, res, next) => {
  try {
    res.json(await actionService.getWebsiteActionsDashboard(req.auth!.organizationId, req.params.id));
  } catch (err) {
    if (err instanceof OwnershipError) return res.status(err.status).json({ error: err.code, message: err.message });
    next(err);
  }
});

businessActionRouter.put('/api/websites/:id/actions/discovered/:intent/override', validateBody(overrideSchema), async (req, res, next) => {
  try {
    const intent = actionIdParamSchema.parse(req.params.intent);
    const override = await actionService.setDiscoveredActionUrlOverride(req.auth!.organizationId, req.auth!.userId, req.params.id, intent, req.body.url);
    res.json(override);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_ACTION_ID', message: 'Invalid Action ID.' });
    if (err instanceof OwnershipError || err instanceof actionService.ActionOverrideValidationError || err instanceof actionService.ActionOverrideStorageError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

businessActionRouter.delete('/api/websites/:id/actions/discovered/:intent/override', async (req, res, next) => {
  try {
    const intent = actionIdParamSchema.parse(req.params.intent);
    await actionService.clearDiscoveredActionUrlOverride(req.auth!.organizationId, req.auth!.userId, req.params.id, intent);
    res.status(204).send();
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_ACTION_ID', message: 'Invalid Action ID.' });
    if (err instanceof OwnershipError || err instanceof actionService.ActionOverrideValidationError || err instanceof actionService.ActionOverrideStorageError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
businessActionRouter.post('/api/websites/:id/actions', validateBody(createActionSchema), async (req, res, next) => {
  try {
    const action = await actionService.createBusinessAction(req.auth!.organizationId, req.auth!.userId, req.params.id, req.body);
    res.status(201).json(action);
  } catch (err) {
    if (err instanceof OwnershipError || err instanceof actionService.BusinessActionValidationError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

businessActionRouter.put('/api/websites/:id/actions/:actionId', validateBody(updateActionSchema), async (req, res, next) => {
  try {
    const actionId = actionIdParamSchema.parse(req.params.actionId);
    const action = await actionService.updateBusinessAction(req.auth!.organizationId, req.auth!.userId, req.params.id, actionId, req.body);
    res.json(action);
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_ACTION_ID', message: 'Invalid Action ID.' });
    if (err instanceof OwnershipError || err instanceof actionService.BusinessActionValidationError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

businessActionRouter.delete('/api/websites/:id/actions/:actionId', async (req, res, next) => {
  try {
    const actionId = actionIdParamSchema.parse(req.params.actionId);
    await actionService.deleteBusinessAction(req.auth!.organizationId, req.auth!.userId, req.params.id, actionId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_ACTION_ID', message: 'Invalid Action ID.' });
    if (err instanceof OwnershipError || err instanceof actionService.BusinessActionValidationError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
