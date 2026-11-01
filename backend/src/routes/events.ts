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
import { clientIp, hours, minutes, rateLimit, siteIdFromRequest, visitorKeyFromRequest } from '../middleware/rateLimit.js';
import { eventsRequestSchema, type EventsRequest } from '../validation/eventSchemas.js';
import { ingestEvents } from '../services/perceptionService.js';
import { config, hasDatabase } from '../config/index.js';
import { getBusinessInstructions } from '../context/instructions.js';
import { publicPopupAction } from '../intelligence/popupActionPolicy.js';
import { generateSafePopup } from '../intelligence/popupPipeline.js';
import { SALES_POLICY } from '../intelligence/config/salesPolicy.config.js';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { resolveTenant, TenantNotFoundError, TenantDisabledError } from '../tenant/tenant.resolver.js';
import { verifyPublicWidgetIdentity } from '../widget/publicIdentity.js';
import { enqueueAnalyticsEvent } from '../analytics/analytics.service.js';
import { enqueueAiDecisionLog, enqueueAiDecisionOutcomes } from '../analytics/decision-log.service.js';
import { findBusinessAction, getEnabledBusinessActions } from '../business-actions/action.service.js';
import { sessionCooldownRemainingMs, popupTrace } from '../intelligence/popupTrace.js';
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import type { GeneratedPopup } from '../intelligence/popupGeneration.js';
import type { SalesDecision } from '../intelligence/types.js';
import type { SafePopupPipelineResult } from '../intelligence/popupPipeline.js';
import type { AnalyticsContext, AnalyticsTenant } from '../analytics/analytics.service.js';
import { logger } from '../logging/logger.js';
import { safeIdentifier } from '../logging/sanitize.js';
import { z } from 'zod';
import { failureCategory } from '../llm/provider/errors.js';
import { completePopup, failPopup, observePopupContext, reservePopup, transitionPopup, type PopupContext, type PopupDeliveryMetadata } from '../intelligence/popupLifecycle.js';

export const eventsRouter = Router();

const eventsLimiter = rateLimit(
  [
    { name: 'public_events_ip', limit: 300, windowMs: minutes(1), key: (req) => clientIp(req) },
    { name: 'public_events_site', limit: 10000, windowMs: hours(1), key: siteIdFromRequest },
    {
      name: 'public_events_site_session',
      limit: 120,
      windowMs: minutes(1),
      key: (req) => {
        const siteId = siteIdFromRequest(req);
        const visitor = visitorKeyFromRequest(req);
        return siteId && visitor ? `${siteId}:${visitor}` : null;
      },
    },
  ],
  { onLimited: 'ignore', ignoredBody: { status: 'ignored', reason: 'rate_limited' } },
);

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
  logger.debug(`[popup] ${stage}`, detail);
}

function clientSuppressionReason(body: EventsRequest): { reason: string; cooldownRemainingMs?: number } | null {
  const state = body.clientState;
  if (!state) return null;
  if (state.safety?.blockedReason) return { reason: state.safety.blockedReason };
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
    decisionId?: string;
  },
): void {
  if (!tenant) return;
  const behaviour = formatBehaviour(decision);
  const intent = formatIntent(decision);
  const rejectedPopup = detail.pipeline?.trace.responseValidation?.ok === false ? detail.pipeline.trace.responseValidation.rejectedPopup : null;
  const action = actionDebug(detail.pipeline);
  enqueueAiDecisionLog(tenant, {
    id: detail.decisionId,
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
    generatedPopupTitle: null,
    ctaType: detail.popup ? ctaIntent(detail.pipeline) : ctaIntent(detail.pipeline),
    ctaText: null,
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
function publicPopup(popup: GeneratedPopup, actions: BusinessActionConfig[], delivery?: PopupDeliveryMetadata) {
  const action = findBusinessAction(actions, popup.primaryAction);
  const secondaryAction = findBusinessAction(actions, popup.secondaryAction);
  return {
    title: popup.title,
    body: popup.body,
    primaryAction: popup.primaryAction,
    secondaryAction: popup.secondaryAction,
    action: action ? publicPopupAction(action) : undefined,
    secondaryActionConfig: secondaryAction ? publicPopupAction(secondaryAction) : undefined,
    tone: popup.tone,
    popupType: popup.popupType,
    delivery,
  };
}

eventsRouter.post('/events', eventsLimiter, async (req, res) => {
  const parsed = eventsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.json(
      ignoredResponse(parsed.error.issues.map((i) => `invalid_envelope:${i.path.join('.')}:${i.message}`)),
    );
  }

  try {
    const body = parsed.data as EventsRequest;
    if (!body.siteId || !body.visitorId || !body.visitorToken) return res.json(ignoredResponse(['identity_required']));
    const identity = verifyPublicWidgetIdentity(body.visitorToken, body.siteId);
    if (!identity || identity.visitorId !== body.visitorId || identity.sessionId !== body.sessionId) return res.json(ignoredResponse(['identity_invalid']));

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
    const popupContext: PopupContext | null = body.lifecycleVersion === 2 && body.pageInstanceId && body.clientState?.safety
      ? { pageInstanceId: body.pageInstanceId, pageStartedAt: body.pageStartedAt ?? 0, ...body.clientState.safety } : null;
    const visitorSession = sessionStore.getOrCreate(body.sessionId, { siteId: publicSiteId, returning: body.returning });
    // Context updates must be admitted even when all semantic events are duplicates.
    if (popupContext && !observePopupContext(visitorSession, popupContext)) return res.json(ignoredResponse(['stale_context']));

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
      devPopupLog('popup_suppressed', { reason: clientSuppressed.reason, session: safeIdentifier(body.sessionId) });
    } else if (result.shadowDecision && result.objective) {
      if (result.shadowDecision.action !== 'speak') {
        popupTrace(body.sessionId, '6_suppression_rules', {
          passed: false,
          reason: result.shadowDecision.suppressedBy ?? 'sales_brain_silent',
          cooldownRemainingMs: sessionCooldownRemainingMs(sessionStore.get(body.sessionId), result.decisionTs ?? 0, SALES_POLICY.cooldownMs),
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
          session: safeIdentifier(body.sessionId),
        });
      } else {
        // Older widgets cannot acknowledge display. Fail closed for proactive
        // delivery until the matching widget asset is installed; chat is intact.
        if (!popupContext) return res.json({ status: result.status, reason: 'lifecycle_upgrade_required' });
        const reservation = reservePopup(visitorSession, popupContext, result.decisionTs ?? 0);
        const candidate = reservation.candidate;
        if (!candidate) return res.json({ status: result.status, reason: reservation.reason });
        const disconnected = () => {
          if (!res.writableEnded && candidate.status === 'generating') {
            candidate.controller.abort(new Error('Widget request disconnected'));
            failPopup(visitorSession, candidate);
          }
        };
        res.once('close', disconnected);
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
          session: safeIdentifier(body.sessionId),
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
            formAssistance: popupContext.formStalled,
            pagePath: body.pageUrl ?? body.pagePath,
          }, { signal: candidate.controller.signal, ...(websiteId ? { refreshActions: () => getEnabledBusinessActions(websiteId!, { skipSeed: true }) } : {}) });

          if (sprint42.ok && sprint42.popup.ok) {
            const copy = sprint42.popup.popup;
            const resolvedActions = sprint42.actions;
            const actionKey = [copy.primaryAction, copy.secondaryAction].filter(Boolean).map(id => {
              const action = resolvedActions.find(a => a.actionId === id);
              return action ? `${action.destinationType}:${action.destination}` : id;
            }).sort().join('|');
            if (!completePopup(visitorSession, candidate, { title: copy.title, body: copy.body, actionKey })) {
              const reason = candidate.rejectionReason ?? 'candidate_obsolete';
              if (candidate.rejectionReason) {
                enqueueAnalyticsEvent(analyticsTenant, analyticsContext, { category: 'POPUP', eventName: 'popup_suppressed', reason, eventId: `${candidate.id}:duplicate_content`, decisionId: candidate.id });
                enqueuePopupDecisionLog(analyticsTenant, analyticsContext, result.shadowDecision, { decisionId: candidate.id, decision: 'Suppressed', reason, popupSuppressed: true, suppressionReason: reason, finalOutcome: 'Suppressed', pipeline: sprint42 });
              }
              return res.json({ status: result.status, reason });
            }
            popupArtifact = { ...publicPopup(sprint42.popup.popup, sprint42.actions),
              delivery: { version: 2 as const, popupId: candidate.id, decisionId: candidate.id, pageInstanceId: candidate.pageInstanceId, contextVersion: candidate.contextVersion, expiresAt: candidate.expiresAt, formAssistance: Boolean(popupContext.formStalled) } };
            popupTrace(body.sessionId, '8_popup_generation', {
              passed: true,
              popupGenerated: true,
              popupType: popupArtifact.popupType,
              title: popupArtifact.title,
              pipelineStages: sprint42.trace.stages,
            });
            popupTrace(body.sessionId, '9_popup_delivery_to_widget', { passed: true, responsePrepared: true, browserDisplayConfirmed: false, popupGenerated: true, popupId: candidate.id });
            enqueueAnalyticsEvent(analyticsTenant, analyticsContext, {
              category: 'POPUP',
              eventName: 'popup_generated',
              eventId: `${candidate.id}:generated`,
              decisionId: candidate.id,
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
              decisionId: candidate.id,
            });
            devPopupLog('popup_generated', {
              session: safeIdentifier(body.sessionId),
              popupType: popupArtifact.popupType,
              tone: popupArtifact.tone,
            });
          } else if (!sprint42.ok) {
            failPopup(visitorSession, candidate);
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
              session: safeIdentifier(body.sessionId),
            });
          }
        } catch (err) {
          failPopup(visitorSession, candidate);
          const detail = candidate.controller.signal.aborted ? 'popup_cancelled' : failureCategory(err) === 'timeout' ? 'popup_timeout' : 'popup_generation_failed';
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
          if (detail !== 'popup_cancelled') logger.warn('[popup] generation failed', { error: err });
          devPopupLog('popup_suppressed', { reason: detail, session: safeIdentifier(body.sessionId) });
        } finally { res.removeListener('close', disconnected); }
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
    logger.warn('[events] ignored ingest error', { error: err });
    return res.json(ignoredResponse(['ingest_error']));
  }
});

const contextSchema = z.object({ pageInstanceId: z.string().uuid(), pageStartedAt: z.number().nonnegative().max(21_600_000), version: z.number().int().nonnegative(), blockedReason: z.string().max(80).nullable(), formStalled: z.boolean() });
const lifecycleSchema = z.object({
  siteId: z.string().min(1).max(100), visitorId: z.string().min(8).max(128), sessionId: z.string().min(8).max(128), visitorToken: z.string().min(1).max(1000),
  operation: z.enum(['context', 'claim', 'displayed', 'release', 'dismissed', 'clicked']),
  popupId: z.string().uuid().optional(), pageInstanceId: z.string().uuid(), context: contextSchema.optional(),
}).strict();

eventsRouter.post('/popup/lifecycle', eventsLimiter, async (req, res) => {
  const parsed = lifecycleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false });
  const body = parsed.data;
  const identity = verifyPublicWidgetIdentity(body.visitorToken, body.siteId);
  if (!identity || identity.visitorId !== body.visitorId || identity.sessionId !== body.sessionId) return res.status(403).json({ ok: false });
  try {
    const tenant = hasDatabase ? await resolveTenant(body.siteId) : null;
    const session = sessionStore.get(body.sessionId);
    if (!session || (session.siteId !== null && session.siteId !== body.siteId)) return res.json({ ok: false, reason: 'session_unavailable' });
    if (body.operation === 'context') {
      if (!body.context || body.context.pageInstanceId !== body.pageInstanceId) return res.status(400).json({ ok: false });
      return res.json({ ok: observePopupContext(session, body.context) });
    }
    if (!body.popupId) return res.status(400).json({ ok: false });
    const result = transitionPopup(session, body.popupId, body.pageInstanceId, body.operation, body.context);
    if (result.ok) {
      const eventName = { claim: 'popup_delivered', displayed: 'popup_displayed', release: 'popup_not_displayed', clicked: 'popup_clicked', dismissed: 'popup_dismissed' }[body.operation];
      const analyticsTenant = tenant ? { organizationId: tenant.organizationId, websiteId: tenant.websiteId } : null;
      const context = { visitorId: body.visitorId, sessionId: body.sessionId };
      const event = { category: 'POPUP' as const, eventName, decisionId: body.popupId, eventId: `${body.popupId}:${eventName}` };
      enqueueAnalyticsEvent(analyticsTenant, context, event);
      enqueueAiDecisionOutcomes(analyticsTenant, context, [event]);
    }
    return res.json({ ok: result.ok, ...(result.candidate?.claimUntil ? { claimUntil: result.candidate.claimUntil } : {}) });
  } catch (error) {
    logger.warn('[popup] lifecycle unavailable', { error });
    return res.status(503).json({ ok: false });
  }
});

