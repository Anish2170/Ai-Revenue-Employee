import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { resolveTenant, TenantDisabledError, TenantNotFoundError } from '../tenant/tenant.resolver.js';
import { validateBody } from '../middleware/validate.js';
import { visitorBehaviourSchema } from '../validation/requestSchemas.js';
import * as conversationService from './conversation.service.js';

export const widgetConversationRouter = Router();
export const conversationRouter = Router();

const renameSchema = z.object({ title: z.string().min(1).max(80) });

const widgetConversationSchema = z.object({
  siteId: z.string().max(100),
  visitorId: z.string().max(100),
  sessionId: z.string().max(100).optional(),
  conversationId: z.string().uuid().optional(),
  opener: z.string().max(500).optional(),
  behaviour: visitorBehaviourSchema.optional(),
});

async function resolveWidgetTenant(siteId: string) {
  try {
    return await resolveTenant(siteId);
  } catch (err) {
    if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) return null;
    throw err;
  }
}

widgetConversationRouter.post('/conversations/restore', validateBody(widgetConversationSchema), async (req, res, next) => {
  try {
    const tenant = await resolveWidgetTenant(req.body.siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    const conversation = await conversationService.restoreConversation({
      tenant,
      visitorId: req.body.visitorId,
      sessionId: req.body.sessionId,
      conversationId: req.body.conversationId,
      behaviour: req.body.behaviour,
    });
    const conversations = await conversationService.listVisitorConversations({ tenant, visitorId: req.body.visitorId });
    res.json({ conversation, conversations });
  } catch (err) {
    next(err);
  }
});

widgetConversationRouter.post('/conversations', validateBody(widgetConversationSchema), async (req, res, next) => {
  try {
    const tenant = await resolveWidgetTenant(req.body.siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    const conversation = await conversationService.createConversation({
      tenant,
      visitorId: req.body.visitorId,
      sessionId: req.body.sessionId,
      behaviour: req.body.behaviour,
      opener: req.body.opener,
    });
    const conversations = await conversationService.listVisitorConversations({ tenant, visitorId: req.body.visitorId });
    res.status(201).json({ conversation, conversations });
  } catch (err) {
    next(err);
  }
});

widgetConversationRouter.get('/conversations', async (req, res, next) => {
  try {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : '';
    const visitorId = typeof req.query.visitorId === 'string' ? req.query.visitorId : '';
    if (!siteId || !visitorId) return res.status(400).json({ error: 'siteId and visitorId are required' });
    const tenant = await resolveWidgetTenant(siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    const conversations = await conversationService.listVisitorConversations({ tenant, visitorId });
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

widgetConversationRouter.get('/conversations/:id', async (req, res, next) => {
  try {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : '';
    const visitorId = typeof req.query.visitorId === 'string' ? req.query.visitorId : '';
    if (!siteId || !visitorId) return res.status(400).json({ error: 'siteId and visitorId are required' });
    const tenant = await resolveWidgetTenant(siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    const conversation = await conversationService.switchConversation({ tenant, visitorId, conversationId: req.params.id });
    const conversations = await conversationService.listVisitorConversations({ tenant, visitorId });
    res.json({ conversation, conversations });
  } catch (err) {
    if (err instanceof conversationService.ConversationNotFoundError) {
      return res.status(err.status).json({ error: 'CONVERSATION_NOT_FOUND', message: err.message });
    }
    next(err);
  }
});

conversationRouter.use(requireAuth);

conversationRouter.get('/api/conversations', async (req, res, next) => {
  try {
    const websiteId = typeof req.query.websiteId === 'string' ? req.query.websiteId : undefined;
    const conversations = await conversationService.listConversations(req.auth!.organizationId, websiteId);
    res.json(conversations);
  } catch (err) {
    next(err);
  }
});

conversationRouter.get('/api/conversations/:id', async (req, res, next) => {
  try {
    const conversation = await conversationService.getConversation(req.auth!.organizationId, req.params.id);
    res.json(conversation);
  } catch (err) {
    if (err instanceof conversationService.ConversationNotFoundError) {
      return res.status(err.status).json({ error: 'CONVERSATION_NOT_FOUND', message: err.message });
    }
    next(err);
  }
});

conversationRouter.patch('/api/conversations/:id/title', validateBody(renameSchema), async (req, res, next) => {
  try {
    const conversation = await conversationService.renameConversation(req.auth!.organizationId, req.params.id, req.body.title);
    res.json(conversation);
  } catch (err) {
    if (err instanceof conversationService.ConversationNotFoundError) {
      return res.status(err.status).json({ error: 'CONVERSATION_NOT_FOUND', message: err.message });
    }
    next(err);
  }
});