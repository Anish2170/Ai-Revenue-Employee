/**
 * POST /events - Sprint 4 semantic-event ingest.
 *
 * The widget streams batched, device-normalized semantic events here. The
 * backend validates, bot-filters, attaches them to a server-side session, runs
 * the deterministic perception loop, and, only when Sales Brain says speak,
 * executes the Sprint 4.2 popup pipeline.
 *
 * The endpoint always responds 200 with a benign acknowledgement. Production
 * responses include only a validated popup artifact when one is safe to show;
 * debug traces remain development-only.
 */
import { Router, type Request } from 'express';
import { eventsRequestSchema, type EventsRequest } from '../validation/eventSchemas.js';
import { ingestEvents } from '../services/perceptionService.js';
import { config, hasDatabase } from '../config/index.js';
import { getBusinessInstructions } from '../context/instructions.js';
import { generateSafePopup } from '../intelligence/popupPipeline.js';
import { SALES_POLICY } from '../intelligence/config/salesPolicy.config.js';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { resolveTenant, TenantNotFoundError, TenantDisabledError } from '../tenant/tenant.resolver.js';
import type { BusinessInstructions } from '../context/types.js';
import type { GeneratedPopup } from '../intelligence/popupGeneration.js';

export const eventsRouter = Router();

function ignoredResponse(dropped: string[] = []) {
  return config.debugTrace
    ? { status: 'ignored' as const, accepted: 0, dropped }
    : { status: 'ignored' as const };
}

function wantsDevSprint42Trace(req: Request): boolean {
  if (config.isProduction) return false;
  return req.query.sprint42 === '1' || req.get('x-aire-dev-pipeline') === 'sprint-4.2';
}

function devPopupLog(stage: string, detail?: unknown): void {
  if (config.isProduction || !config.debugTrace) return;
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  console.log(`[popup] ${stage}${suffix}`);
}

function clientSuppressionReason(body: EventsRequest): string | null {
  const state = body.clientState;
  if (!state) return null;
  if (state.chatOpen) return 'chat_open';
  if (state.popupActive) return 'popup_active';
  if (state.dismissed) return 'dismissed';
  if (state.popupShown) return 'already_shown';
  if ((state.popupCount ?? 0) >= SALES_POLICY.maxInterruptionsPerSession) return 'frequency_budget';
  if (typeof state.lastPopupAt === 'number' && Date.now() - state.lastPopupAt < SALES_POLICY.cooldownMs) {
    return 'cooldown';
  }
  return null;
}

function publicPopup(popup: GeneratedPopup) {
  return {
    title: popup.title,
    body: popup.body,
    cta: popup.cta,
    tone: popup.tone,
    popupType: popup.popupType,
  };
}

eventsRouter.post('/events', async (req, res) => {
  const parsed = eventsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.json(
      ignoredResponse(parsed.error.issues.map((i) => `invalid_envelope:${i.path.join('.')}:${i.message}`)),
    );
  }

  try {
    const body = parsed.data as EventsRequest;

    let publicSiteId: string | null = null;
    let websiteId: string | undefined;
    let instructions: BusinessInstructions | undefined;

    if (body.siteId && hasDatabase) {
      try {
        const t = await resolveTenant(body.siteId);
        publicSiteId = t.siteId;
        websiteId = t.websiteId;
        instructions = t.instructions;
      } catch (err) {
        // Unknown/disabled tenant -> ack and drop (never leak, never 500).
        if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) {
          return res.json(ignoredResponse(['tenant_unavailable']));
        }
        throw err;
      }
    }

    const result = ingestEvents({
      siteId: publicSiteId,
      sessionId: body.sessionId,
      returning: body.returning,
      surface: body.surface,
      rawEvents: body.events,
      botSignal: body.botSignal,
      instructions,
      clientState: body.clientState,
    });

    let sprint42 = undefined;
    let popupArtifact = undefined;

    const clientSuppressed = clientSuppressionReason(body);
    if (clientSuppressed) {
      devPopupLog('popup_suppressed', { reason: clientSuppressed, sessionId: body.sessionId.slice(0, 8) });
    } else if (result.shadowDecision && result.objective) {
      if (result.shadowDecision.action !== 'speak') {
        devPopupLog('popup_suppressed', {
          reason: result.shadowDecision.suppressedBy ?? 'sales_brain_silent',
          action: result.shadowDecision.action,
          sessionId: body.sessionId.slice(0, 8),
        });
      } else {
        const pipelineInstructions = instructions ?? getBusinessInstructions();
        devPopupLog('popup_requested', {
          sessionId: body.sessionId.slice(0, 8),
          websiteId: websiteId ?? null,
          score: result.shadowDecision.speakScore,
        });

        try {
          sprint42 = await generateSafePopup({
            decision: result.shadowDecision,
            objective: result.objective,
            business: { name: pipelineInstructions.businessName },
            instructions: pipelineInstructions,
            websiteId,
          });

          if (sprint42.ok && sprint42.popup.ok) {
            sessionStore.recordInterruption(body.sessionId, result.decisionTs ?? 0);
            popupArtifact = publicPopup(sprint42.popup.popup);
            devPopupLog('popup_generated', {
              sessionId: body.sessionId.slice(0, 8),
              popupType: popupArtifact.popupType,
              tone: popupArtifact.tone,
            });
          } else if (!sprint42.ok) {
            devPopupLog('popup_suppressed', {
              reason: sprint42.reason,
              stoppedAt: sprint42.stoppedAt,
              sessionId: body.sessionId.slice(0, 8),
            });
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'Unknown Sprint 4.2 pipeline error';
          sprint42 = { ok: false, stoppedAt: 'pipeline_error', reason: detail };
          devPopupLog('popup_suppressed', { reason: detail, sessionId: body.sessionId.slice(0, 8) });
        }
      }
    }

    // Public response stays minimal; debug trace only outside production.
    return res.json(
      config.debugTrace
        ? {
            status: result.status,
            accepted: result.accepted,
            dropped: result.dropped,
            debug: result.shadowDecision?.trace,
            ...(popupArtifact ? { popup: popupArtifact } : {}),
            ...(wantsDevSprint42Trace(req) && sprint42 ? { sprint42 } : {}),
          }
        : { status: result.status, ...(popupArtifact ? { popup: popupArtifact } : {}) },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown /events error';
    console.warn('[events] ignored ingest error:', message);
    return res.json(ignoredResponse(['ingest_error']));
  }
});