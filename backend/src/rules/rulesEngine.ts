/**
 * Rules Engine — deterministic gates around the LLM.
 *
 * Two phases:
 *   1. shouldEvaluate()  — PRE-LLM gate: decides whether an LLM call is even
 *      worth making (eligibility thresholds, cooldown, frequency cap, already
 *      shown / dismissed). Short-circuits cheap, non-engaged traffic.
 *   2. finalizeDecision() — POST-LLM gate: applies the confidence floor and
 *      duplicate-prevention to whatever the LLM produced.
 *
 * Sprint 1 constraint: there is no server-side session store, so this engine is
 * STATELESS. It trusts the {@link SessionState} the widget sends. Sprint 2 swaps
 * a real store in behind this same interface with no pipeline changes.
 */
import { policy } from '../config/policy.js';
import type { EngageDecision, SessionState, VisitorBehaviour } from '../types.js';

/** Result of the pre-LLM gate. */
export interface PreGateResult {
  /** Whether the pipeline should proceed to call the LLM. */
  proceed: boolean;
  /** Stable label for the matched rule (surfaced in the debug trace). */
  ruleMatched: string;
  /** Human-readable explanation. */
  reason: string;
  /** Which eligibility signals fired (for prompt + debugging). */
  signals: string[];
  /** Coarse 0–1 engagement score derived from the signals. */
  score: number;
}

/**
 * PRE-LLM gate. Decides whether this visitor is engaged enough — and eligible
 * under cooldown/frequency rules — to justify an LLM evaluation.
 */
export function shouldEvaluate(behaviour: VisitorBehaviour, session: SessionState): PreGateResult {
  // Hard stops: never re-engage after a popup was shown or dismissed this page.
  if (session.popupShown) {
    return { proceed: false, ruleMatched: 'already_shown', reason: 'A popup was already shown this session.', signals: [], score: 0 };
  }
  if (session.dismissed) {
    return { proceed: false, ruleMatched: 'dismissed', reason: 'The visitor dismissed a popup this session.', signals: [], score: 0 };
  }
  if (session.engageCount >= policy.maxEngagePerSession) {
    return { proceed: false, ruleMatched: 'frequency_cap', reason: 'Max engage evaluations reached for this session.', signals: [], score: 0 };
  }

  // Cooldown: enforce minimum spacing between evaluations.
  if (session.lastEngageAt !== null) {
    const elapsedSeconds = (Date.now() - session.lastEngageAt) / 1000;
    if (elapsedSeconds < policy.cooldownSeconds) {
      const remaining = Math.ceil(policy.cooldownSeconds - elapsedSeconds);
      return { proceed: false, ruleMatched: 'cooldown', reason: `Cooldown active; ${remaining}s remaining.`, signals: [], score: 0 };
    }
  }

  // Eligibility: collect which engagement signals are present.
  const e = policy.eligibility;
  const signals: string[] = [];
  if (behaviour.timeOnPage >= e.minTimeOnPage) signals.push('dwell');
  if (behaviour.scrollDepth >= e.minScrollDepth) signals.push('deep_scroll');
  if (e.clickIsSignal && behaviour.clickedElements.length > 0) signals.push('click');
  if (e.formIsSignal && behaviour.formInteracted) signals.push('form');
  if (e.exitIntentIsSignal && behaviour.exitIntent) signals.push('exit_intent');

  if (signals.length === 0) {
    return {
      proceed: false,
      ruleMatched: 'below_threshold',
      reason: 'No engagement signals met the eligibility thresholds.',
      signals,
      score: 0,
    };
  }

  // Coarse score: fraction of the five possible signals that fired.
  const score = Math.min(1, signals.length / 5 + 0.2);
  return {
    proceed: true,
    ruleMatched: signals.includes('exit_intent') ? 'exit_intent_engagement' : 'engaged_visitor',
    reason: `Engagement signals present: ${signals.join(', ')}.`,
    signals,
    score: Number(score.toFixed(2)),
  };
}

/**
 * POST-LLM gate. Applies the confidence floor and dedup to the validated LLM
 * decision. The LLM may say "show", but the rules engine has final say.
 */
export function finalizeDecision(decision: EngageDecision, session: SessionState): EngageDecision {
  if (!decision.showPopup) return decision;

  // Confidence floor.
  if ((decision.confidence ?? 0) < policy.minConfidence) {
    return { showPopup: false };
  }

  // Dedup: defense-in-depth against a stale/duplicate request that slipped past
  // the pre-gate (widget remains the primary owner of this in Sprint 1).
  if (session.popupShown || session.dismissed) {
    return { showPopup: false };
  }

  return decision;
}
