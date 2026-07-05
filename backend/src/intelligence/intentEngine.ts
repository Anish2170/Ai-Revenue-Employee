/**
 * Intent Engine (§5).
 *
 * Single responsibility: map a BehaviourState → what the visitor is trying to
 * accomplish (GOAL) and how close they are (READINESS). These are two SEPARATE
 * axes (§1, §5.2): "Compare + hot" and "Compare + cold" are opposite moments.
 *
 * It does NOT decide whether to speak (that's the Sales Brain) and does NOT
 * compute overall confidence (that's §6). Pure and deterministic.
 */
import {
  GOALS,
  type BehaviourLabel,
  type BehaviourState,
  type Goal,
  type GoalAlternative,
  type IntentRead,
  type Readiness,
} from './types.js';

/**
 * Goal mapping table: each behaviour state contributes weight to goals.
 * Weighted so a state can point mostly at one goal but partly at others.
 */
const GOAL_CONTRIBUTIONS: Record<BehaviourLabel, Partial<Record<Goal, number>>> = {
  Browsing: { Learn: 0.6, Undecided: 0.3 },
  Researching: { Learn: 0.8, Compare: 0.2 },
  Comparing: { Compare: 0.9, EvaluatePrice: 0.2 },
  PriceSensitive: { EvaluatePrice: 0.9, Compare: 0.2 },
  TrustSeeking: { Learn: 0.4, Compare: 0.3 },
  Hesitating: { EvaluatePrice: 0.4, BuyBook: 0.4 },
  Ready: { BuyBook: 1.0 },
  Distracted: { Undecided: 0.7 },
};

/** Margin under which the top two goals are considered a conflict (§6.5). */
const CONFLICT_MARGIN = 0.15;

/**
 * Derive readiness from trajectory + presence of action-oriented states,
 * INDEPENDENTLY of which goal won.
 */
function deriveReadiness(behaviour: BehaviourState): Readiness {
  const ready = behaviour.vector.Ready ?? 0;
  const hesitating = behaviour.vector.Hesitating ?? 0;
  const priceSensitive = behaviour.vector.PriceSensitive ?? 0;
  const comparing = behaviour.vector.Comparing ?? 0;

  // HOT: a decisive action signal, or Ready dominant.
  if (ready >= 0.5 || behaviour.dominant === 'Ready') return 'hot';

  // WARM: momentum forward, or active evaluation/comparison/hesitation.
  if (
    behaviour.trajectory === 'warming' ||
    hesitating >= 0.4 ||
    priceSensitive >= 0.4 ||
    comparing >= 0.4
  ) {
    return 'warm';
  }

  // COLD: everything else (early browse/research, flat, distracted).
  return 'cold';
}

/** Accumulate goal weights from the behaviour vector. */
function scoreGoals(behaviour: BehaviourState): Map<Goal, number> {
  const scores = new Map<Goal, number>();
  for (const label of Object.keys(behaviour.vector) as BehaviourLabel[]) {
    const stateWeight = behaviour.vector[label] ?? 0;
    const contributions = GOAL_CONTRIBUTIONS[label];
    for (const goal of Object.keys(contributions) as Goal[]) {
      const add = (contributions[goal] ?? 0) * stateWeight;
      scores.set(goal, (scores.get(goal) ?? 0) + add);
    }
  }
  return scores;
}

/**
 * Run the Intent Engine.
 *
 * @param behaviour The behaviour state from the Behaviour Engine.
 * @param returning Whether this is a returning visitor (routes to GetSupport
 *                  when they dwell on support/account zones — read by §8).
 */
export function runIntentEngine(behaviour: BehaviourState, returning = false): IntentRead {
  const scores = scoreGoals(behaviour);

  // Returning visitor sitting in trust/contact zones with no buying momentum →
  // treat as a support-leaning goal (the goal layer decides to never sell).
  if (returning && behaviour.trajectory !== 'warming' && (behaviour.dominant === 'TrustSeeking' || behaviour.dominant === 'Browsing')) {
    scores.set('GetSupport', (scores.get('GetSupport') ?? 0) + 0.6);
  }

  // Rank goals.
  const ranked: GoalAlternative[] = GOALS.map((goal) => ({ goal, weight: Number((scores.get(goal) ?? 0).toFixed(4)) }))
    .filter((g) => g.weight > 0)
    .sort((a, b) => b.weight - a.weight);

  // No signal at all → Undecided, cold.
  if (ranked.length === 0) {
    return {
      goal: 'Undecided',
      readiness: 'cold',
      alternatives: [],
      conflict: false,
      reason: 'No goal-bearing behaviour yet.',
    };
  }

  const top = ranked[0];
  const runnerUp = ranked[1];
  const conflict = runnerUp !== undefined && top.weight - runnerUp.weight < CONFLICT_MARGIN;
  const readiness = deriveReadiness(behaviour);

  const reason = conflict
    ? `Goal ${top.goal} (${top.weight}) narrowly over ${runnerUp!.goal} (${runnerUp!.weight}); readiness ${readiness}.`
    : `Goal ${top.goal} (${top.weight}); readiness ${readiness}.`;

  return {
    goal: top.goal,
    readiness,
    alternatives: ranked.slice(1),
    conflict,
    reason,
  };
}
