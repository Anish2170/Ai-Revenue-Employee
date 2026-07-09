/**
 * Perception ingest service (Sprint 4.1).
 *
 * Orchestrates the /events pipeline:
 *
 *   validate (§10.4) → bot-filter (§10.5) → attach to server-side session
 *   → perceive() in SHADOW mode → log the decision trace
 *
 * Sprint 4.2 consumes the deterministic Sales Brain decision after this service
 * returns. This service still does not call the LLM or render UI itself.
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
import { SALES_POLICY } from '../intelligence/config/salesPolicy.config.js';
import { cooldownRemainingMs, popupTrace } from '../intelligence/popupTrace.js';
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessObjective, SalesDecision, Surface } from '../intelligence/types.js';

export interface IngestClientState {
  dismissed?: boolean;
}

export interface IngestOptions {
  siteId: string | null;
  sessionId: string;
  returning: boolean;
  surface: Surface;
  rawEvents: unknown[];
  botSignal?: BotSignal;
  instructions?: BusinessInstructions;
  clientState?: IngestClientState;
}

export interface IngestResult {
  /** Always "ack" in Sprint 4.1 (shadow mode) — the widget takes no action. */
  status: 'ack' | 'bot' | 'ignored';
  /** How many events were accepted after quality checks. */
  accepted: number;
  /** How many were dropped, and why (dev trace only). */
  dropped: string[];
  /** The deterministic Sales Brain decision. Callers decide whether to enact it. */
  shadowDecision?: SalesDecision;
  /** Objective used for the deterministic decision. */
  objective?: BusinessObjective;
  /** Latest monotonic session timestamp used by the Sales Brain. */
  decisionTs?: number;
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

  if (opts.clientState?.dismissed) {
    sessionStore.markDismissed(opts.sessionId);
  }

  // 1. Event-quality validation (cross-batch sequence checks use seenKinds).
  const { clean, dropped } = validateEvents(opts.rawEvents, session.seenKinds);
  popupTrace(opts.sessionId, '1_event_quality', {
    passed: clean.length > 0,
    acceptedThisBatch: clean.length,
    dropped,
    cleanEvents: clean.map((e) => ({ type: e.type, zone: e.zone, intensity: e.intensity, ts: e.ts })),
  });

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

  popupTrace(opts.sessionId, '0_session_context', {
    passed: true,
    sessionEventCount: session.events.length,
    priorInterruptions: session.priorInterruptions,
    lastInterruptionTs: session.lastInterruptionTs,
    dismissed: session.dismissed,
    cooldownRemainingMs: cooldownRemainingMs(session.lastInterruptionTs, now, SALES_POLICY.cooldownMs),
  });

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

  const trace = decision.trace;
  popupTrace(opts.sessionId, '2_behavior_engine', {
    passed: true,
    currentBehavior: trace.behaviour,
  });
  popupTrace(opts.sessionId, '3_intent_engine', {
    passed: true,
    currentIntent: trace.intent,
  });
  popupTrace(opts.sessionId, '4_ai_sales_brain', {
    passed: decision.action === 'speak',
    action: decision.action,
    popupConfidence: trace.confidence,
    speakScore: decision.speakScore,
    threshold: trace.policy.threshold,
    scorePassed: trace.policy.speakScore >= trace.policy.threshold,
    suppressionReason: decision.suppressedBy,
    cooldownRemainingMs: cooldownRemainingMs(session.lastInterruptionTs, now, SALES_POLICY.cooldownMs),
    because: decision.because,
  });
  popupTrace(opts.sessionId, '5_popup_eligibility', {
    passed: decision.action === 'speak',
    popupGenerated: false,
    reason: decision.action === 'speak' ? null : decision.suppressedBy ?? 'score_below_threshold',
  });

  // 5. Shadow log — this is the whole point of 4.1: observe what we WOULD do.
  if (config.debugTrace) {
    logShadowDecision(opts.sessionId, decision);
  }

  return {
    status: 'ack',
    accepted: clean.length,
    dropped,
    shadowDecision: decision,
    objective,
    decisionTs: now,
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
