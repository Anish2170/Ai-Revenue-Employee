/**
 * Perception ingest service (Sprint 4.1).
 *
 * Orchestrates the /events pipeline:
 *
 *   validate (§10.4) → bot-filter (§10.5) → attach to server-side session
 *   → perceive() in SHADOW mode → log the decision trace
 *
 * Shadow mode means: we compute the full Sales Brain decision and log it, but we
 * NEVER enact a popup and NEVER call the LLM. That is Sprint 4.2. The endpoint
 * therefore only ever tells the widget "ack" — it changes nothing the visitor sees.
 *
 * Every path is safe: malformed input, bots, and errors all resolve to a benign
 * acknowledgement. The widget can never be broken by this endpoint (§10.6).
 */
import { validateEvents } from '../intelligence/ingest/eventQuality.js';
import { classifyBot, type BotSignal } from '../intelligence/ingest/botFilter.js';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { perceive } from '../intelligence/perceive.js';
import { objectiveFromInstructions, DEFAULT_OBJECTIVE } from '../intelligence/businessObjective.js';
import { config } from '../config/index.js';
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessObjective, SalesDecision, Surface } from '../intelligence/types.js';

export interface IngestOptions {
  siteId: string | null;
  sessionId: string;
  returning: boolean;
  surface: Surface;
  rawEvents: unknown[];
  botSignal?: BotSignal;
  instructions?: BusinessInstructions;
}

export interface IngestResult {
  /** Always "ack" in Sprint 4.1 (shadow mode) — the widget takes no action. */
  status: 'ack' | 'bot' | 'ignored';
  /** How many events were accepted after quality checks. */
  accepted: number;
  /** How many were dropped, and why (dev trace only). */
  dropped: string[];
  /** The shadow decision (dev trace only; never enacted in 4.1). */
  shadowDecision?: SalesDecision;
  /** Objective used for the shadow decision, needed by dev-only Sprint 4.2 tracing. */
  objective?: BusinessObjective;
}

/**
 * Ingest one batch of semantic events for a session and run the perception loop
 * in shadow mode. Returns a benign acknowledgement plus (in dev) a debug trace.
 */
export function ingestEvents(opts: IngestOptions): IngestResult {
  const session = sessionStore.getOrCreate(opts.sessionId, {
    siteId: opts.siteId,
    returning: opts.returning,
  });

  // Already flagged as a bot → cheap short-circuit, never perceive again.
  if (session.bot) {
    return { status: 'bot', accepted: 0, dropped: ['session_flagged_bot'] };
  }

  // 1. Event-quality validation (cross-batch sequence checks use seenKinds).
  const { clean, dropped } = validateEvents(opts.rawEvents, session.seenKinds);

  // 2. Attach accepted events to the server-side session.
  sessionStore.appendEvents(opts.sessionId, clean);

  // 3. Bot filtering over the full accumulated session (+ client signals).
  const verdict = classifyBot(session.events, opts.botSignal ?? {});
  if (verdict.isBot) {
    sessionStore.markBot(opts.sessionId);
    return { status: 'bot', accepted: clean.length, dropped: [...dropped, `bot:${verdict.reason}`] };
  }

  // Nothing usable this batch → ack without perceiving.
  if (session.events.length === 0) {
    return { status: 'ignored', accepted: 0, dropped };
  }

  // 4. Perceive (shadow). `now` = latest event ts (the session's own clock).
  const now = session.events[session.events.length - 1].ts;
  const objective = opts.instructions ? objectiveFromInstructions(opts.instructions) : DEFAULT_OBJECTIVE;

  const decision = perceive({
    events: session.events,
    now,
    context: {
      priorInterruptions: session.priorInterruptions,
      lastInterruptionTs: session.lastInterruptionTs,
      dismissed: session.dismissed,
      returning: session.returning,
    },
    objective,
    surface: opts.surface,
    shadow: true,
  });

  // 5. Shadow log — this is the whole point of 4.1: observe what we WOULD do.
  if (config.debugTrace) {
    logShadowDecision(opts.sessionId, decision);
  }

  return {
    status: 'ack',
    accepted: clean.length,
    dropped,
    shadowDecision: config.debugTrace ? decision : undefined,
    objective: config.debugTrace ? objective : undefined,
  };
}

function logShadowDecision(sessionId: string, decision: SalesDecision): void {
  const p = decision.trace.policy;
  // One-line, greppable shadow trace. In 4.3 this becomes an observer-port emit.
  console.log(
    `[perceive:shadow] session=${sessionId.slice(0, 8)} action=${decision.action}` +
      ` score=${p.speakScore}/${p.threshold} suppressed=${decision.suppressedBy ?? '-'}` +
      ` :: ${decision.because}`,
  );
}
