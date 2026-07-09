/**
 * Sales Brain — heuristic decision policy (§7).
 *
 * Consumes behaviour + intent + confidence + business objective + perception
 * context (NEVER raw events beyond the summaries) and produces a SalesDecision
 * with a stated reason.
 *
 *   speakScore =  W_conf·confidence + W_ready·readinessScore + W_value·goalValue
 *               − W_fatigue·interruptionFatigue − W_bad·badMomentPenalty
 *
 *   speak ⟺ speakScore ≥ threshold AND band ≠ low AND not suppressed
 *
 * Sprint 4.1 runs this in SHADOW MODE: the decision is computed and logged, but
 * no popup is enacted and the LLM (stage 8) is never called. That happens in
 * Sprint 4.2.
 */
import { SALES_POLICY } from './config/salesPolicy.config.js';
import {
  type BehaviourState,
  type BusinessObjective,
  type ConfidenceResult,
  type IntentRead,
  type PerceptionContext,
  type SalesDecision,
  type SalesDecisionTrace,
  type Surface,
} from './types.js';

export interface BrainInput {
  behaviour: BehaviourState;
  intent: IntentRead;
  confidence: ConfidenceResult;
  context: PerceptionContext;
  objective: BusinessObjective;
  surface: Surface;
  /** Monotonic ms for cooldown/fatigue decay math. */
  now: number;
  /**
   * Whether the knowledge check (RAG has something true & useful) passed.
   * Sprint 4.1 has no RAG wired into the loop yet, so callers default true;
   * Sprint 4.2 supplies the real result. Kept explicit so the gate exists now.
   */
  knowledgeOk?: boolean;
  /** Shadow mode — default true in Sprint 4.1. */
  shadow?: boolean;
}

/** Interruption fatigue with 5-min half-life decay from the last interruption. */
function interruptionFatigue(ctx: PerceptionContext, now: number): number {
  const base = Math.min(1, ctx.priorInterruptions * SALES_POLICY.fatiguePerInterruption);
  if (base === 0 || ctx.lastInterruptionTs === null) return base;
  const age = Math.max(0, now - ctx.lastInterruptionTs);
  const decay = Math.pow(0.5, age / SALES_POLICY.fatigueHalfLifeMs);
  return clamp01(base * decay);
}

/** Bad moment: distracted / idle / mid-typing / fling — never interrupt (§7.3). */
function badMomentPenalty(behaviour: BehaviourState): number {
  if (behaviour.dominant === 'Distracted') return 1;
  return 0;
}

/**
 * Suppression gate (§7.4) — hard blocks checked BEFORE the score even matters.
 * Returns the name of the first rule that forces silence, or null.
 */
function suppressionReason(input: BrainInput): string | null {
  const { behaviour, confidence, context, objective, intent, now } = input;

  if (badMomentPenalty(behaviour) === 1) return 'distracted';
  if (context.dismissed) return 'recently_dismissed';
  if (confidence.band === 'low') return 'low_confidence';
  if (input.knowledgeOk === false) return 'no_knowledge';

  // Frequency budget.
  if (context.priorInterruptions >= SALES_POLICY.maxInterruptionsPerSession) {
    return 'frequency_budget';
  }

  // Cooldown.
  if (context.lastInterruptionTs !== null) {
    const elapsed = now - context.lastInterruptionTs;
    if (elapsed < SALES_POLICY.cooldownMs) return 'cooldown';
  }

  // Support goal + returning customer → never push a sales CTA.
  if (objective.isSupport && context.returning && intent.goal !== 'GetSupport') {
    return 'support_no_sell';
  }

  return null;
}

/** Compute the raw speakScore (§7.2), independent of suppression. */
function computeSpeakScore(input: BrainInput): SalesDecisionTrace['policy'] {
  const { confidence, intent, objective, context, surface, now } = input;
  const w = SALES_POLICY.weights;
  const p = SALES_POLICY.penalties;

  const readinessScore = SALES_POLICY.readinessScore[intent.readiness];
  const goalValue = clamp01(objective.goalValue);
  const fatigue = interruptionFatigue(context, now);
  const bad = badMomentPenalty(input.behaviour);

  const speakScore =
    w.confidence * confidence.score +
    w.readiness * readinessScore +
    w.value * goalValue -
    p.fatigue * fatigue -
    p.badMoment * bad;

  const threshold = SALES_POLICY.speakThreshold[surface];

  return {
    wConf: w.confidence,
    wReady: w.readiness,
    wValue: w.value,
    wFatigue: p.fatigue,
    wBad: p.badMoment,
    readinessScore,
    goalValue: round(goalValue),
    interruptionFatigue: round(fatigue),
    badMomentPenalty: bad,
    speakScore: round(speakScore),
    threshold,
  };
}

/**
 * Run the Sales Brain. Returns a SalesDecision; in shadow mode the caller only
 * logs `action` and never enacts it.
 */
export function runSalesBrain(input: BrainInput): SalesDecision {
  const shadow = input.shadow ?? true;
  const policy = computeSpeakScore(input);
  const suppressedBy = suppressionReason(input);

  const scoreClears = policy.speakScore >= policy.threshold;
  const bandOk = input.confidence.band !== 'low';
  const action = suppressedBy === null && scoreClears && bandOk ? 'speak' : 'silent';

  const because = buildReason(input, policy, suppressedBy, action);

  const trace: SalesDecisionTrace = {
    behaviour: input.behaviour,
    intent: input.intent,
    confidence: input.confidence,
    policy,
    suppressedBy,
    action,
    shadow,
  };

  return { action, speakScore: policy.speakScore, suppressedBy, because, trace };
}

function buildReason(
  input: BrainInput,
  policy: SalesDecisionTrace['policy'],
  suppressedBy: string | null,
  action: 'speak' | 'silent',
): string {
  const { behaviour, intent, confidence, objective } = input;
  const head = `${behaviour.dominant} (${behaviour.dominantWeight}), goal ${intent.goal}, readiness ${intent.readiness}, confidence ${confidence.score} [${confidence.band}].`;
  if (suppressedBy) {
    return `Silent — suppressed by ${suppressedBy}. ${head}`;
  }
  if (action === 'speak') {
    return `Speak — score ${policy.speakScore} ≥ ${policy.threshold} (goal ${objective.key}, value ${policy.goalValue}). ${head}`;
  }
  return `Silent — score ${policy.speakScore} < ${policy.threshold}. ${head}`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(n: number): number {
  return Number(n.toFixed(4));
}
