/**
 * Confidence system (§6).
 *
 *   confidence = E · C · S · R
 *
 * Multiplicative on purpose: any weak or contradictory factor collapses the
 * score, so one pricing glance next to an exit signal cannot masquerade as
 * certainty (§6.2). Deterministic; `now` passed in for testability.
 */
import { CONFIDENCE_CONFIG } from './config/confidence.config.js';
import {
  type BehaviourState,
  type ConfidenceBand,
  type ConfidenceInputs,
  type ConfidenceResult,
  type IntentRead,
  type SemanticEvent,
} from './types.js';

/**
 * Count INDEPENDENT supporting signals for the dominant read. We count distinct
 * (type,zone) event kinds that fed the dominant behaviour — three pricing
 * revisits of the same kind corroborate less than three different signals, but
 * we keep it simple and defensible for MVP: distinct event kinds, plus a bump
 * for repeated evidence of the same kind (diminishing).
 */
function countIndependentEvidence(events: readonly SemanticEvent[], now: number): number {
  const kinds = new Map<string, number>();
  for (const ev of events) {
    if (ev.ts > now) continue;
    const key = `${ev.type}:${ev.zone}`;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }
  // Distinct kinds count fully; repeats of a kind add a diminishing 0.5 each,
  // capped so a single spammed event can't fake high evidence.
  let n = 0;
  for (const count of kinds.values()) {
    n += 1 + Math.min(2, count - 1) * 0.5;
  }
  return n;
}

/** E = 1 − exp(−k·n): saturating evidence strength. */
function evidenceStrength(n: number): number {
  return 1 - Math.exp(-CONFIDENCE_CONFIG.evidenceK * n);
}

/**
 * C = 1 − penalties. Penalize intent conflict and trajectory that contradicts
 * the dominant behaviour (e.g. "Ready" but cooling, or exit while evaluating).
 */
function consistency(behaviour: BehaviourState, intent: IntentRead): number {
  let penalty = 0;
  if (intent.conflict) penalty += CONFIDENCE_CONFIG.penalties.intentConflict;

  const forwardDominant =
    behaviour.dominant === 'Ready' ||
    behaviour.dominant === 'Hesitating' ||
    behaviour.dominant === 'Comparing' ||
    behaviour.dominant === 'PriceSensitive';
  if (forwardDominant && behaviour.trajectory === 'cooling') {
    penalty += CONFIDENCE_CONFIG.penalties.trajectoryContradiction;
  }
  return clamp01(1 - penalty);
}

/** R = 0.5 ^ (age_of_freshest_evidence / halfLife). */
function recency(events: readonly SemanticEvent[], now: number): number {
  let freshest = -Infinity;
  for (const ev of events) {
    if (ev.ts > now) continue;
    if (ev.ts > freshest) freshest = ev.ts;
  }
  if (freshest === -Infinity) return 0;
  const age = now - freshest;
  return Math.pow(0.5, age / CONFIDENCE_CONFIG.halfLifeMs);
}

function toBand(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_CONFIG.bands.high) return 'high';
  if (score >= CONFIDENCE_CONFIG.bands.medium) return 'medium';
  return 'low';
}

/**
 * Compute confidence over the current perception.
 *
 * @param behaviour Behaviour state (for stability + consistency).
 * @param intent    Intent read (for conflict).
 * @param events    The event window (for evidence + recency).
 * @param now       Monotonic ms.
 */
export function computeConfidence(
  behaviour: BehaviourState,
  intent: IntentRead,
  events: readonly SemanticEvent[],
  now: number,
): ConfidenceResult {
  const n = countIndependentEvidence(events, now);
  const E = evidenceStrength(n);
  const C = consistency(behaviour, intent);
  const S = behaviour.stability === 'settled' ? CONFIDENCE_CONFIG.stability.settled : CONFIDENCE_CONFIG.stability.volatile;
  const R = recency(events, now);

  const score = clamp01(E * C * S * R);
  const inputs: ConfidenceInputs = {
    E: round(E),
    C: round(C),
    S: round(S),
    R: round(R),
  };

  return { score: round(score), band: toBand(score), inputs };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function round(n: number): number {
  return Number(n.toFixed(4));
}
