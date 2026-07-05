/**
 * POST /events - Sprint 4.1 semantic-event ingest (shadow mode).
 *
 * The widget streams batched, device-normalized semantic events here. The
 * backend validates, bot-filters, attaches them to a server-side session, and
 * runs the perception loop in SHADOW mode (compute + log, never enact).
 *
 * Always responds 200 with a benign acknowledgement - like /engage, this
 * endpoint can never break the widget. The dev-only debug trace carries the
 * shadow decision for inspection.
 */
import { Router, type Request } from 'express';
import { eventsRequestSchema, type EventsRequest } from '../validation/eventSchemas.js';
import { ingestEvents } from '../services/perceptionService.js';
import { config, hasDatabase } from '../config/index.js';
import { getBusinessInstructions } from '../context/instructions.js';
import { generateSafePopup } from '../intelligence/popupPipeline.js';
import { resolveTenant, TenantNotFoundError, TenantDisabledError } from '../tenant/tenant.resolver.js';
import type { BusinessInstructions } from '../context/types.js';

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

eventsRouter.post('/events', async (req, res) => {
  const parsed = eventsRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.json(
      ignoredResponse(parsed.error.issues.map((i) => `invalid_envelope:${i.path.join('.')}:${i.message}`)),
    );
  }

  try {
    const body = parsed.data as EventsRequest;

    let siteId: string | null = null;
    let instructions: BusinessInstructions | undefined;

    if (body.siteId && hasDatabase) {
      try {
        const t = await resolveTenant(body.siteId);
        siteId = t.siteId;
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
      siteId,
      sessionId: body.sessionId,
      returning: body.returning,
      surface: body.surface,
      rawEvents: body.events,
      botSignal: body.botSignal,
      instructions,
    });

    let sprint42 = undefined;
    if (wantsDevSprint42Trace(req) && result.shadowDecision && result.objective) {
      const pipelineInstructions = instructions ?? getBusinessInstructions();
      try {
        sprint42 = await generateSafePopup({
          decision: result.shadowDecision,
          objective: result.objective,
          business: { name: pipelineInstructions.businessName },
          instructions: pipelineInstructions,
          websiteId: siteId ?? undefined,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown Sprint 4.2 pipeline error';
        sprint42 = { ok: false, stoppedAt: 'pipeline_error', reason: detail };
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
            ...(sprint42 ? { sprint42 } : {}),
          }
        : { status: result.status },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown /events error';
    console.warn('[events] ignored ingest error:', message);
    return res.json(ignoredResponse(['ingest_error']));
  }
});