/**
 * POST /chat - stream an assistant reply over Server-Sent Events.
 *
 * Sprint 3: resolves tenant from siteId when DB is configured.
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
import { clientIp, hours, minutes, rateLimit, siteIdFromRequest, visitorKeyFromRequest } from '../middleware/rateLimit.js';
import { chatRequestSchema } from '../validation/requestSchemas.js';
import { llmAvailable } from '../llm/index.js';
import { streamChatReply } from '../services/chatService.js';
import { config, hasDatabase } from '../config/index.js';
import { resolveTenant, TenantNotFoundError, TenantDisabledError } from '../tenant/tenant.resolver.js';
import { appendAssistantMessage, prepareConversationForChat, scheduleConversationMaintenance, type PromptConversationContext } from '../conversations/conversation.service.js';
import { captureLeadFromConversation } from '../leads/lead.service.js';
import { resolveTenantFromRequestOrigin } from '../tenant/originSnapshotTenant.resolver.js';
import type { BusinessInstructions } from '../context/types.js';
import type { ChatRequest } from '../validation/requestSchemas.js';
import { logger } from '../logging/logger.js';
import { verifyPublicWidgetRequestIdentity } from '../widget/publicIdentity.js';

export const chatRouter = Router();

const chatLimiter = rateLimit([
  { name: 'public_chat_ip', limit: 30, windowMs: minutes(1), key: (req) => clientIp(req) },
  { name: 'public_chat_site', limit: 300, windowMs: hours(1), key: siteIdFromRequest },
  {
    name: 'public_chat_site_visitor',
    limit: 20,
    windowMs: minutes(1),
    key: (req) => {
      const siteId = siteIdFromRequest(req);
      const visitor = visitorKeyFromRequest(req);
      return siteId && visitor ? `${siteId}:${visitor}` : null;
    },
  },
]);

function chatTrace(requestId: string, stage: string, detail?: unknown): void {
  if (!config.debugTrace) return;
  logger.debug(`[chat:${requestId}] ${stage}`, detail);
}

chatRouter.post('/chat', chatLimiter, validateBody(chatRequestSchema), async (req, res) => {
  const requestId = randomUUID().slice(0, 8);
  chatTrace(requestId, 'entered /chat');

  const body = req.body as ChatRequest;
  if (!verifyPublicWidgetRequestIdentity(body)) {
    return res.status(403).json({ error: 'INVALID_WIDGET_SESSION' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const done = () => {
    res.write('data: [DONE]\n\n');
    res.end();
  };

  if (!llmAvailable()) {
    chatTrace(requestId, 'LLM unavailable', { reason: 'missing GEMINI_API_KEY' });
    send({ error: "Sorry, I'm having trouble responding right now. Please try again in a moment." });
    return done();
  }

  try {
    const { siteId, conversationId, visitorId, sessionId, messages, behaviour } = body;
    chatTrace(requestId, 'request parsed', {
      siteId: siteId || null,
      messages: messages.length,
      hasConversationId: Boolean(conversationId), hasVisitorId: Boolean(visitorId), hasSessionId: Boolean(sessionId),
      hasBehaviour: Boolean(behaviour),
      databaseEnabled: hasDatabase,
    });

    let tenant: { organizationId?: string; websiteId: string; instructions: BusinessInstructions } | undefined;
    let tenantSource: 'database' | 'origin_snapshot' | 'none' = 'none';

    if (hasDatabase) {
      chatTrace(requestId, 'tenant_resolve:start', { siteId });
      try {
        const t = await resolveTenant(siteId);
        tenant = { organizationId: t.organizationId, websiteId: t.websiteId, instructions: t.instructions };
        tenantSource = 'database';
        chatTrace(requestId, 'tenant_resolve:success', {
          source: tenantSource,
          siteId: t.siteId,
          websiteId: t.websiteId,
        });
      } catch (err) {
        if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) {
          chatTrace(requestId, 'tenant_resolve:blocked', { reason: err.message });
          send({ error: 'Widget not found or disabled.' });
          return done();
        }

        logger.error(`[chat:${requestId}] tenant_resolve:error`, { error: err });
        const originTenant = await resolveTenantFromRequestOrigin({
          siteId,
          origin: req.get('origin'),
          referer: req.get('referer'),
        });
        if (!originTenant) {
          chatTrace(requestId, 'tenant_resolve:failed_closed', {
            reason: 'tenant database unavailable and no unique origin-matched tenant snapshot found',
          });
          send({ error: 'Tenant context unavailable. Please try again shortly.' });
          return done();
        }

        tenant = { websiteId: originTenant.tenant.websiteId, instructions: originTenant.tenant.instructions };
        tenantSource = 'origin_snapshot';
        chatTrace(requestId, 'tenant_resolve:success', {
          source: tenantSource,
          matchedBy: originTenant.matchedBy,
          siteId: originTenant.tenant.siteId,
          websiteId: originTenant.tenant.websiteId,
        });
      }
    } else {
      chatTrace(requestId, 'tenant_resolve:database_disabled', { siteId });
      const originTenant = await resolveTenantFromRequestOrigin({
        siteId,
        origin: req.get('origin'),
        referer: req.get('referer'),
      });
      if (originTenant) {
        tenant = { websiteId: originTenant.tenant.websiteId, instructions: originTenant.tenant.instructions };
        tenantSource = 'origin_snapshot';
        chatTrace(requestId, 'tenant_resolve:success', {
          source: tenantSource,
          matchedBy: originTenant.matchedBy,
          siteId: originTenant.tenant.siteId,
          websiteId: originTenant.tenant.websiteId,
        });
      } else {
        chatTrace(requestId, 'tenant_resolve:failed_closed', {
          reason: 'database disabled and no unique origin-matched tenant snapshot found',
        });
      }
    }

    if (!tenant) {
      chatTrace(requestId, 'tenant_resolve:failed_closed', { reason: 'siteId request has no tenant context' });
      send({ error: 'Tenant context unavailable. Please try again shortly.' });
      return done();
    }

    chatTrace(requestId, 'resolved tenant', {
      source: tenantSource,
      websiteId: tenant?.websiteId ?? null,
    });

    let conversation: { id: string; title: string; titleStatus: string } | undefined;
    let promptContext: PromptConversationContext | undefined;
    if (hasDatabase && tenantSource === 'database' && tenant?.organizationId) {
      const prepared = await prepareConversationForChat({
        tenant: { organizationId: tenant.organizationId, websiteId: tenant.websiteId },
        conversationId,
        visitorId,
        sessionId,
        messages,
        behaviour,
      });
      conversation = prepared.conversation;
      promptContext = prepared.prompt;
      send({ conversation: { id: conversation.id, title: conversation.title, titleStatus: conversation.titleStatus } });
    }

    const stream = await streamChatReply({ messages: promptContext?.recentMessages ?? messages, behaviour, tenant, conversation: promptContext, debug: { requestId } });
    let finalResponse = '';
    let source: { title: string; url: string } | null = null;
    for await (const event of stream) {
      if (event.type === 'token') {
        finalResponse += event.text;
        send({ token: event.text });
      } else if (event.type === 'source') {
        source = event.source;
        send({ source: event.source });
      }
    }

    if (conversation) {
      await appendAssistantMessage({ conversationId: conversation.id, content: finalResponse, source });
      if (tenant?.organizationId) {
        await captureLeadFromConversation({
          tenant: { organizationId: tenant.organizationId, websiteId: tenant.websiteId },
          conversationId: conversation.id,
          visitorId,
          sessionId,
          messages: promptContext?.recentMessages ?? messages,
          assistantReply: finalResponse,
          behaviour,
        });
      }
      scheduleConversationMaintenance(conversation.id);
    }

    chatTrace(requestId, 'response_validation', {
      status: 'not_applicable',
      reason: 'streaming chat route has no response validator; popup response validation is separate',
    });
    chatTrace(requestId, 'final response', {
      chars: finalResponse.length,
      empty: finalResponse.length === 0,
    });
    done();
  } catch (err) {
    logger.error(`[chat:${requestId}] stream error`, { error: err });
    send({ error: "Sorry, I'm having trouble responding right now. Please try again in a moment." });
    done();
  }
});






