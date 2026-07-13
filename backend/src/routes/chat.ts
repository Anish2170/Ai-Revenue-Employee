/**
 * POST /chat - stream an assistant reply over Server-Sent Events.
 *
 * Sprint 3: resolves tenant from siteId when DB is configured.
 */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { validateBody } from '../middleware/validate.js';
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

export const chatRouter = Router();

function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { value: String(err) };
  return { name: err.name, message: err.message };
}

function chatTrace(requestId: string, stage: string, detail?: unknown): void {
  if (!config.debugTrace) return;
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  console.log(`[chat:${requestId}] ${stage}${suffix}`);
}

chatRouter.post('/chat', validateBody(chatRequestSchema), async (req, res) => {
  const requestId = randomUUID().slice(0, 8);
  chatTrace(requestId, 'entered /chat');

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
    send({ error: 'LLM not configured.' });
    return done();
  }

  try {
    const { siteId, conversationId, visitorId, sessionId, messages, behaviour } = req.body as ChatRequest;
    chatTrace(requestId, 'request parsed', {
      siteId: siteId || null,
      messages: messages.length,
      conversationId: conversationId || null,
      visitorId: visitorId || null,
      sessionId: sessionId || null,
      hasBehaviour: Boolean(behaviour),
      databaseEnabled: hasDatabase,
    });

    let tenant: { organizationId?: string; websiteId: string; instructions: BusinessInstructions } | undefined;
    let tenantSource: 'database' | 'origin_snapshot' | 'none' = 'none';

    if (siteId && hasDatabase) {
      chatTrace(requestId, 'tenant_resolve:start', { siteId });
      try {
        const t = await resolveTenant(siteId);
        tenant = { organizationId: t.organizationId, websiteId: t.websiteId, instructions: t.instructions };
        tenantSource = 'database';
        chatTrace(requestId, 'tenant_resolve:success', {
          source: tenantSource,
          siteId: t.siteId,
          websiteId: t.websiteId,
          websiteUrl: t.websiteUrl,
          businessInstructions: t.instructions,
        });
      } catch (err) {
        if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) {
          chatTrace(requestId, 'tenant_resolve:blocked', { reason: err.message });
          send({ error: 'Widget not found or disabled.' });
          return done();
        }

        console.error(`[chat:${requestId}] tenant_resolve:error`, serializeError(err));
        const originTenant = await resolveTenantFromRequestOrigin({
          siteId,
          origin: req.get('origin'),
          referer: req.get('referer'),
        });
        if (!originTenant) {
          chatTrace(requestId, 'tenant_resolve:failed_closed', {
            reason: 'tenant database unavailable and no unique origin-matched tenant snapshot found',
            origin: req.get('origin') ?? null,
            referer: req.get('referer') ?? null,
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
          websiteUrl: originTenant.tenant.websiteUrl,
          sourceUrl: originTenant.sourceUrl,
          businessInstructions: originTenant.tenant.instructions,
        });
      }
    } else if (siteId) {
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
          websiteUrl: originTenant.tenant.websiteUrl,
          sourceUrl: originTenant.sourceUrl,
          businessInstructions: originTenant.tenant.instructions,
        });
      } else {
        chatTrace(requestId, 'tenant_resolve:failed_closed', {
          reason: 'database disabled and no unique origin-matched tenant snapshot found',
          origin: req.get('origin') ?? null,
          referer: req.get('referer') ?? null,
        });
      }
    } else {
      chatTrace(requestId, 'tenant_resolve:skipped', { reason: 'missing siteId; dev fallback allowed' });
    }

    if (siteId && !tenant) {
      chatTrace(requestId, 'tenant_resolve:failed_closed', { reason: 'siteId request has no tenant context' });
      send({ error: 'Tenant context unavailable. Please try again shortly.' });
      return done();
    }

    chatTrace(requestId, 'resolved tenant', {
      source: tenantSource,
      websiteId: tenant?.websiteId ?? null,
      businessInstructions: tenant?.instructions ?? null,
    });

    let conversation: { id: string; title: string; titleStatus: string } | undefined;
    let promptContext: PromptConversationContext | undefined;
    if (hasDatabase && tenantSource === 'database' && tenant?.organizationId) {
      const prepared = await prepareConversationForChat({
        tenant: { organizationId: tenant.organizationId, websiteId: tenant.websiteId },
        conversationId,
        visitorId: visitorId || sessionId || requestId,
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
          visitorId: visitorId || sessionId || requestId,
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
      text: finalResponse,
    });
    done();
  } catch (err) {
    console.error(`[chat:${requestId}] stream error`, serializeError(err));
    send({ error: 'Sorry, something went wrong generating a reply.' });
    done();
  }
});






