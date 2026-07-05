/**
 * Behaviour Engine (§4).
 *
 * Single responsibility: convert a semantic event stream into a weighted
 * BehaviourState. Answers *how* the visitor is acting — nothing about goals,
 * readiness, business logic, or copy.
 *
 * Pure and deterministic: same events + same `now` → same output. No LLM, no
 * I/O. `now` is passed in (never read implicitly) so the engine is trivially
 * testable and time-travelable in golden tests.
 *
 * Behaviours are probabilistic HYPOTHESES, not facts — every weight is
 * "evidence so far suggests," and the Confidence layer (§6) exists to reason
 * about exactly that uncertainty.
 */
import {
  BEHAVIOUR_LABELS,
  type BehaviourLabel,
  type BehaviourState,
  type SemanticEvent,
  type Trajectory,
  type Stability,
} from './types.js';
import {
  BEHAVIOUR_RULES,
  BEHAVIOUR_CONFIG,
  FORWARD_STATES,
  BACKWARD_STATES,
} from './config/behaviourRules.js';
import { CONFIDENCE_CONFIG } from './config/confidence.config.js';

/** Exponential decay factor for an event `age` ms old (§6.3). */
function decayFor(ageMs: number): number {
  return Math.pow(0.5, ageMs / CONFIDENCE_CONFIG.halfLifeMs);
}

/** Empty vector accumulator. */
type Vector = Partial<Record<BehaviourLabel, number>>;

/**
 * Accumulate decayed, intensity-scaled evidence into a state vector for the
 * events up to (and including) `now`. Each state weight is clamped to 0..1.
 */
function accumulate(events: readonly SemanticEvent[], now: number): Vector {
  const vector: Vector = {};
  for (const ev of events) {
    if (ev.ts > now) continue; // ignore future events (defensive; ingest should drop these)
    const age = now - ev.ts;
    const decay = decayFor(age);
    const intensity = clamp01(ev.intensity);
    for (const rule of BEHAVIOUR_RULES) {
      if (rule.type !== ev.type) continue;
      if (rule.zone && rule.zone !== ev.zone) continue;
      const add = rule.weight * intensity * decay;
      vector[rule.state] = clamp01((vector[rule.state] ?? 0) + add);
    }
  }
  return vector;
}

/** Pick the dominant state deterministically (ties → BEHAVIOUR_LABELS order). */
function pickDominant(vector: Vector): { label: BehaviourLabel; weight: number } {
  let best: BehaviourLabel = 'Browsing';
  let bestWeight = -1;
  for (const label of BEHAVIOUR_LABELS) {
    const w = vector[label] ?? 0;
    if (w > bestWeight) {
      best = label;
      bestWeight = w;
    }
  }
  return { label: best, weight: Math.max(0, bestWeight) };
}

/**
 * Trajectory: recompute the dominant state at a few recent checkpoints and see
 * whether forward-funnel weight is rising (warming), falling (cooling), or flat.
 * We sample the dominant weight at evenly spaced suffixes of the event stream.
 */
function computeTrajectory(events: readonly SemanticEvent[], now: number): Trajectory {
  const inWindow = events.filter((e) => e.ts <= now);
  if (inWindow.length < 2) return 'flat';

  const samples = BEHAVIOUR_CONFIG.trajectoryWindow;
  const scores: number[] = [];
  for (let i = 1; i <= samples; i++) {
    // Reconstruct the vector as it stood after the first (n * i / samples) events.
    const cutoff = Math.ceil((inWindow.length * i) / samples);
    const slice = inWindow.slice(0, cutoff);
    const asOf = slice[slice.length - 1].ts;
    const v = accumulate(slice, asOf);
    scores.push(forwardScore(v));
  }

  const delta = scores[scores.length - 1] - scores[0];
  if (delta > BEHAVIOUR_CONFIG.trajectoryEpsilon) return 'warming';
  if (delta < -BEHAVIOUR_CONFIG.trajectoryEpsilon) return 'cooling';
  return 'flat';
}

/** Net "forward funnel" score of a vector: forward states minus backward states. */
function forwardScore(vector: Vector): number {
  let fwd = 0;
  let bwd = 0;
  for (const s of FORWARD_STATES) fwd += vector[s] ?? 0;
  for (const s of BACKWARD_STATES) bwd += vector[s] ?? 0;
  return fwd - bwd;
}

/**
 * Stability: volatile when the dominant state changed in the most recent step or
 * when two states are near-tied for dominance (the read is flickering).
 */
function computeStability(events: readonly SemanticEvent[], now: number, vector: Vector): Stability {
  const inWindow = events.filter((e) => e.ts <= now);
  if (inWindow.length >= 2) {
    const prevSlice = inWindow.slice(0, inWindow.length - 1);
    const prevAsOf = prevSlice[prevSlice.length - 1].ts;
    const prevDominant = pickDominant(accumulate(prevSlice, prevAsOf)).label;
    const currentDominant = pickDominant(vector).label;
    if (prevDominant !== currentDominant) return 'volatile';
  }

  // Near-tie check: top two within 0.15 → volatile.
  const sorted = Object.values(vector).sort((a, b) => b - a);
  if (sorted.length >= 2 && sorted[0] - sorted[1] < 0.15 && sorted[0] > 0.2) {
    return 'volatile';
  }
  return 'settled';
}

/**
 * Run the Behaviour Engine over the full event window as of `now`.
 *
 * @param events Semantic events for this session (any order; filtered by ts).
 * @param now    Monotonic ms (same clock as event.ts) to evaluate "as of".
 */
export function runBehaviourEngine(events: readonly SemanticEvent[], now: number): BehaviourState {
  const vector = accumulate(events, now);
  const dominant = pickDominant(vector);
  const trajectory = computeTrajectory(events, now);
  const stability = computeStability(events, now, vector);

  return {
    vector,
    dominant: dominant.label,
    dominantWeight: Number(dominant.weight.toFixed(4)),
    trajectory,
    stability,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
