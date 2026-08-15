import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { resolveTenant, TenantDisabledError, TenantNotFoundError } from '../tenant/tenant.resolver.js';
import { validateBody } from '../middleware/validate.js';
import { authUserKey, clientIp, minutes, rateLimit, siteIdFromRequest, visitorKeyFromRequest } from '../middleware/rateLimit.js';
import { visitorBehaviourSchema } from '../validation/requestSchemas.js';
import * as conversationService from './conversation.service.js';
import { verifyPublicWidgetIdentity } from '../widget/publicIdentity.js';

export const widgetConversationRouter = Router();
export const conversationRouter = Router();

const renameSchema = z.object({ title: z.string().min(1).max(80) });

const widgetConversationSchema = z.object({
  siteId: z.string().max(100),
  visitorToken: z.string().min(1).max(1000),
  visitorId: z.string().max(100),
  sessionId: z.string().max(100).optional(),
  conversationId: z.string().uuid().optional(),
  opener: z.string().max(500).optional(),
  behaviour: visitorBehaviourSchema.optional(),
});

const widgetConversationLimiter = rateLimit([
  { name: 'public_conversations_ip', limit: 120, windowMs: minutes(1), key: (req) => clientIp(req) },
  {
    name: 'public_conversations_site_visitor',
    limit: 60,
    windowMs: minutes(1),
    key: (req) => {
      const siteId = siteIdFromRequest(req);
      const visitor = visitorKeyFromRequest(req);
      return siteId && visitor ? `${siteId}:${visitor}` : null;
    },
  },
]);

const dashboardConversationLimiter = rateLimit([
  { name: 'dashboard_conversations_user', limit: 600, windowMs: minutes(1), key: authUserKey },
]);

async function resolveWidgetTenant(siteId: string) {
  try {
    return await resolveTenant(siteId);
  } catch (err) {
    if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) return null;
    throw err;
  }
}
function validIdentity(input: { siteId: string; visitorId: string; sessionId?: string; visitorToken: string }): boolean {
  const identity = verifyPublicWidgetIdentity(input.visitorToken, input.siteId);
  return Boolean(identity && identity.visitorId === input.visitorId && (!input.sessionId || identity.sessionId === input.sessionId));
}

widgetConversationRouter.post('/conversations/restore', widgetConversationLimiter, validateBody(widgetConversationSchema), async (req, res, next) => {
  try {
    const tenant = await resolveWidgetTenant(req.body.siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    if (!validIdentity(req.body)) return res.status(403).json({ error: 'INVALID_WIDGET_SESSION' });
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

widgetConversationRouter.post('/conversations', widgetConversationLimiter, validateBody(widgetConversationSchema), async (req, res, next) => {
  try {
    const tenant = await resolveWidgetTenant(req.body.siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    if (!validIdentity(req.body)) return res.status(403).json({ error: 'INVALID_WIDGET_SESSION' });
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

widgetConversationRouter.get('/conversations', widgetConversationLimiter, async (req, res, next) => {
  try {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : '';
    const visitorId = typeof req.query.visitorId === 'string' ? req.query.visitorId : '';
    const visitorToken = typeof req.query.visitorToken === 'string' ? req.query.visitorToken : '';
    if (!siteId || !visitorId) return res.status(400).json({ error: 'siteId and visitorId are required' });
    const tenant = await resolveWidgetTenant(siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    if (!validIdentity({ siteId, visitorId, visitorToken })) return res.status(403).json({ error: 'INVALID_WIDGET_SESSION' });
    const conversations = await conversationService.listVisitorConversations({ tenant, visitorId });
    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

widgetConversationRouter.get('/conversations/:id', widgetConversationLimiter, async (req, res, next) => {
  try {
    const siteId = typeof req.query.siteId === 'string' ? req.query.siteId : '';
    const visitorId = typeof req.query.visitorId === 'string' ? req.query.visitorId : '';
    const visitorToken = typeof req.query.visitorToken === 'string' ? req.query.visitorToken : '';
    if (!siteId || !visitorId) return res.status(400).json({ error: 'siteId and visitorId are required' });
    const tenant = await resolveWidgetTenant(siteId);
    if (!tenant) return res.status(404).json({ error: 'TENANT_NOT_FOUND' });
    if (!validIdentity({ siteId, visitorId, visitorToken })) return res.status(403).json({ error: 'INVALID_WIDGET_SESSION' });
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

conversationRouter.use(requireAuth, dashboardConversationLimiter);

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
