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
import { enqueueAnalyticsEvent } from '../analytics/analytics.service.js';
import { enqueueAiDecisionLog } from '../analytics/decision-log.service.js';
import { findBusinessAction } from '../business-actions/action.service.js';
import { cooldownRemainingMs, popupTrace } from '../intelligence/popupTrace.js';
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import type { GeneratedPopup } from '../intelligence/popupGeneration.js';
import type { SalesDecision } from '../intelligence/types.js';
import type { SafePopupPipelineResult } from '../intelligence/popupPipeline.js';
import type { AnalyticsContext, AnalyticsTenant } from '../analytics/analytics.service.js';

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

function clientSuppressionReason(body: EventsRequest): { reason: string; cooldownRemainingMs?: number } | null {
  const state = body.clientState;
  if (!state) return null;
  if (state.chatOpen) return { reason: 'chat_open' };
  if (state.popupActive) return { reason: 'popup_active' };
  if (state.dismissed) return { reason: 'dismissed' };
  if (state.popupShown) return { reason: 'already_shown' };
  if ((state.popupCount ?? 0) >= SALES_POLICY.maxInterruptionsPerSession) return { reason: 'frequency_budget' };
  if (typeof state.lastPopupAt === 'number' && Date.now() - state.lastPopupAt < SALES_POLICY.cooldownMs) {
    return { reason: 'cooldown', cooldownRemainingMs: Math.max(0, SALES_POLICY.cooldownMs - (Date.now() - state.lastPopupAt)) };
  }
  return null;
}


function formatBehaviour(decision?: SalesDecision): { summary?: string; dominant?: string } {
  const behaviour = decision?.trace.behaviour;
  if (!behaviour) return {};
  return {
    dominant: behaviour.dominant,
    summary: `${behaviour.dominant} (${Math.round(behaviour.dominantWeight * 100)}%), ${behaviour.trajectory}, ${behaviour.stability}`,
  };
}

function formatIntent(decision?: SalesDecision): { summary?: string; goal?: string; readiness?: string } {
  const intent = decision?.trace.intent;
  if (!intent) return {};
  return {
    goal: intent.goal,
    readiness: intent.readiness,
    summary: `${intent.goal} intent, ${intent.readiness} readiness${intent.conflict ? ', conflicting signals' : ''}. ${intent.reason}`,
  };
}

function strategyKind(pipeline?: SafePopupPipelineResult): string | undefined {
  return pipeline?.trace.strategy?.kind;
}

function ctaIntent(pipeline?: SafePopupPipelineResult): string | undefined {
  return pipeline?.trace.strategy?.ctaIntent;
}

function validationPassed(pipeline?: SafePopupPipelineResult): boolean {
  return Boolean(pipeline?.trace.responseValidation?.ok);
}

function actionDebug(pipeline?: SafePopupPipelineResult) {
  return pipeline?.trace.responseValidation?.actionDebug;
}

function llmUsed(pipeline?: SafePopupPipelineResult): boolean {
  return Boolean(pipeline?.trace.stages.includes('llm'));
}

function enqueuePopupDecisionLog(
  tenant: AnalyticsTenant | null,
  context: AnalyticsContext,
  decision: SalesDecision | undefined,
  detail: {
    decision: string;
    reason?: string | null;
    popupGenerated?: boolean;
    popupSuppressed?: boolean;
    suppressionReason?: string | null;
    finalOutcome: string;
    pipeline?: SafePopupPipelineResult;
    popup?: ReturnType<typeof publicPopup>;
  },
): void {
  if (!tenant) return;
  const behaviour = formatBehaviour(decision);
  const intent = formatIntent(decision);
  const rejectedPopup = detail.pipeline?.trace.responseValidation?.ok === false ? detail.pipeline.trace.responseValidation.rejectedPopup : null;
  const action = actionDebug(detail.pipeline);
  enqueueAiDecisionLog(tenant, {
    ...context,
    occurredAt: new Date(),
    behaviorSummary: behaviour.summary,
    behaviorDominant: behaviour.dominant,
    intentSummary: intent.summary,
    intentGoal: intent.goal,
    intentReadiness: intent.readiness,
    salesStrategy: strategyKind(detail.pipeline),
    confidenceScore: decision?.trace.confidence.score,
    confidenceBand: decision?.trace.confidence.band,
    speakScore: decision?.speakScore,
    decision: detail.decision,
    reason: detail.reason ?? decision?.because ?? null,
    popupGenerated: detail.popupGenerated ?? false,
    popupSuppressed: detail.popupSuppressed ?? false,
    suppressionReason: detail.suppressionReason ?? null,
    generatedPopupType: detail.popup?.popupType ?? rejectedPopup?.popupType ?? null,
    generatedPopupTitle: detail.popup?.title ?? rejectedPopup?.title ?? null,
    ctaType: detail.popup ? ctaIntent(detail.pipeline) : ctaIntent(detail.pipeline),
    ctaText: detail.popup?.action?.label ?? null,
    ctaActionId: detail.popup?.primaryAction ?? rejectedPopup?.primaryAction ?? null,
    expectedAction: action?.expectedAction ?? false,
    primaryActionReturned: action?.primaryActionReturned ?? null,
    fallbackApplied: action?.fallbackApplied ?? false,
    fallbackUsed: action?.fallbackUsed ?? null,
    missingActionReason: action?.missingActionReason ?? null,
    llmUsed: llmUsed(detail.pipeline),
    validationPassed: validationPassed(detail.pipeline),
    finalOutcome: detail.finalOutcome,
  });
}
function publicPopup(popup: GeneratedPopup, actions: BusinessActionConfig[]) {
  const action = findBusinessAction(actions, popup.primaryAction);
  const secondaryAction = findBusinessAction(actions, popup.secondaryAction);
  return {
    title: popup.title,
    body: popup.body,
    primaryAction: popup.primaryAction,
    secondaryAction: popup.secondaryAction,
    action: action ?? undefined,
    secondaryActionConfig: secondaryAction ?? undefined,
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
    let organizationId: string | undefined;
    let instructions: BusinessInstructions | undefined;
    let businessActions: BusinessActionConfig[] = [];

    if (body.siteId && hasDatabase) {
      try {
        const t = await resolveTenant(body.siteId);
        publicSiteId = t.siteId;
        websiteId = t.websiteId;
        organizationId = t.organizationId;
        instructions = t.instructions;
        businessActions = t.businessActions;
      } catch (err) {
        // Unknown/disabled tenant -> ack and drop (never leak, never 500).
        if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) {
          return res.json(ignoredResponse(['tenant_unavailable']));
        }
        throw err;
      }
    }

    const analyticsTenant = organizationId && websiteId ? { organizationId, websiteId } : null;
    const analyticsContext = {
      visitorId: body.visitorId,
      sessionId: body.sessionId,
      returning: body.returning,
      pageUrl: body.pageUrl,
      pagePath: body.pagePath,
      pageTitle: body.pageTitle,
      referrer: body.referrer,
      device: body.device,
      browser: body.browser,
      surface: body.surface,
    };

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

    let sprint42: SafePopupPipelineResult | undefined = undefined;
    let popupArtifact: ReturnType<typeof publicPopup> | undefined = undefined;

    const clientSuppressed = clientSuppressionReason(body);
    if (clientSuppressed) {
      popupTrace(body.sessionId, '6_suppression_rules', { passed: false, reason: clientSuppressed.reason, cooldownRemainingMs: clientSuppressed.cooldownRemainingMs ?? 0, source: 'widget_client_state', popupGenerated: false });
      enqueueAnalyticsEvent(analyticsTenant, analyticsContext, { category: 'POPUP', eventName: 'popup_suppressed', reason: clientSuppressed.reason });
      enqueuePopupDecisionLog(analyticsTenant, analyticsContext, result.shadowDecision, {
        decision: 'Suppressed',
        reason: clientSuppressed.reason,
        popupSuppressed: true,
        suppressionReason: clientSuppressed.reason,
        finalOutcome: 'Suppressed',
      });
      devPopupLog('popup_suppressed', { reason: clientSuppressed.reason, sessionId: body.sessionId.slice(0, 8) });
    } else if (result.shadowDecision && result.objective) {
      if (result.shadowDecision.action !== 'speak') {
        popupTrace(body.sessionId, '6_suppression_rules', {
          passed: false,
          reason: result.shadowDecision.suppressedBy ?? 'sales_brain_silent',
          cooldownRemainingMs: cooldownRemainingMs(sessionStore.get(body.sessionId)?.lastInterruptionTs ?? null, result.decisionTs ?? 0, SALES_POLICY.cooldownMs),
          popupGenerated: false,
        });
        enqueueAnalyticsEvent(analyticsTenant, analyticsContext, {
          category: 'POPUP',
          eventName: 'popup_suppressed',
          reason: result.shadowDecision.suppressedBy ?? 'sales_brain_silent',
          label: result.shadowDecision.action,
        });
        enqueuePopupDecisionLog(analyticsTenant, analyticsContext, result.shadowDecision, {
          decision: 'Suppressed',
          reason: result.shadowDecision.because,
          popupSuppressed: true,
          suppressionReason: result.shadowDecision.suppressedBy ?? 'sales_brain_silent',
          finalOutcome: 'Suppressed',
        });
        devPopupLog('popup_suppressed', {
          reason: result.shadowDecision.suppressedBy ?? 'sales_brain_silent',
          action: result.shadowDecision.action,
          sessionId: body.sessionId.slice(0, 8),
        });
      } else {
        const pipelineInstructions = instructions ?? getBusinessInstructions();
        popupTrace(body.sessionId, '6_suppression_rules', { passed: true, reason: null, cooldownRemainingMs: 0 });
        popupTrace(body.sessionId, '7_cooldown', { passed: true, cooldownRemainingMs: 0 });
        popupTrace(body.sessionId, '8_popup_generation_requested', { passed: true, speakScore: result.shadowDecision.speakScore, currentIntent: result.shadowDecision.trace.intent });
        enqueueAnalyticsEvent(analyticsTenant, analyticsContext, {
          category: 'POPUP',
          eventName: 'popup_requested',
          numericValue: result.shadowDecision.speakScore,
        });
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
            businessActions,
          });

          if (sprint42.ok && sprint42.popup.ok) {
            sessionStore.recordInterruption(body.sessionId, result.decisionTs ?? 0);
            popupArtifact = publicPopup(sprint42.popup.popup, businessActions);
            popupTrace(body.sessionId, '8_popup_generation', {
              passed: true,
              popupGenerated: true,
              popupType: popupArtifact.popupType,
              title: popupArtifact.title,
              pipelineStages: sprint42.trace.stages,
            });
            popupTrace(body.sessionId, '9_popup_delivery_to_widget', { passed: true, delivered: true, popupGenerated: true });
            enqueueAnalyticsEvent(analyticsTenant, analyticsContext, {
              category: 'POPUP',
              eventName: 'popup_generated',
              popupType: popupArtifact.popupType,
              label: popupArtifact.tone,
              actionId: popupArtifact.primaryAction,
            });
            enqueuePopupDecisionLog(analyticsTenant, analyticsContext, result.shadowDecision, {
              decision: 'Popup Generated',
              reason: result.shadowDecision.because,
              popupGenerated: true,
              popupSuppressed: false,
              finalOutcome: 'Generated',
              pipeline: sprint42,
              popup: popupArtifact,
            });
            devPopupLog('popup_generated', {
              sessionId: body.sessionId.slice(0, 8),
              popupType: popupArtifact.popupType,
              tone: popupArtifact.tone,
            });
          } else if (!sprint42.ok) {
            popupTrace(body.sessionId, '8_popup_generation', {
              passed: false,
              popupGenerated: false,
              stoppedAt: sprint42.stoppedAt,
              reason: sprint42.reason,
              pipelineStages: sprint42.trace.stages,
            });
            popupTrace(body.sessionId, '9_popup_delivery_to_widget', { passed: false, delivered: false, reason: sprint42.reason });
            enqueueAnalyticsEvent(analyticsTenant, analyticsContext, {
              category: 'POPUP',
              eventName: 'popup_suppressed',
              reason: sprint42.reason,
              label: sprint42.stoppedAt,
            });
            enqueuePopupDecisionLog(analyticsTenant, analyticsContext, result.shadowDecision, {
              decision: 'Suppressed',
              reason: sprint42.reason,
              popupGenerated: false,
              popupSuppressed: true,
              suppressionReason: sprint42.reason,
              finalOutcome: 'Suppressed',
              pipeline: sprint42,
            });
            devPopupLog('popup_suppressed', {
              reason: sprint42.reason,
              stoppedAt: sprint42.stoppedAt,
              sessionId: body.sessionId.slice(0, 8),
            });
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'Unknown Sprint 4.2 pipeline error';
          popupTrace(body.sessionId, '8_popup_generation', { passed: false, popupGenerated: false, stoppedAt: 'pipeline_error', reason: detail });
          popupTrace(body.sessionId, '9_popup_delivery_to_widget', { passed: false, delivered: false, reason: detail });
          enqueueAnalyticsEvent(analyticsTenant, analyticsContext, { category: 'POPUP', eventName: 'popup_suppressed', reason: detail, label: 'pipeline_error' });
          enqueuePopupDecisionLog(analyticsTenant, analyticsContext, result.shadowDecision, {
            decision: 'Suppressed',
            reason: detail,
            popupGenerated: false,
            popupSuppressed: true,
            suppressionReason: detail,
            finalOutcome: 'Suppressed',
          });
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

