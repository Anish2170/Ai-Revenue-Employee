/**
 * Sales Brain heuristic-policy constants (§7.2).
 *
 * speakScore =  W_conf   · confidence
 *             + W_ready  · readinessScore
 *             + W_value  · goalValue
 *             − W_fatigue· interruptionFatigue
 *             − W_bad    · badMomentPenalty
 *
 * This transparent, tunable policy replaces the previous draft's theoretical EV
 * equation. It is fully deterministic and unit-testable today, and is the
 * bootstrap for the learned model in Sprint 6 (the weights become a fitted
 * logistic function over the same features — a drop-in, not a re-architecture).
 */
import type { Readiness } from '../types.js';

export const SALES_POLICY = {
  /** Linear weights on the positive terms. */
  weights: {
    confidence: 0.5,
    readiness: 0.3,
    value: 0.2,
  },

  /** Penalty weights on the negative terms. */
  penalties: {
    fatigue: 0.5,
    badMoment: 0.6,
  },

  /**
   * Speak threshold. speakScore ≥ threshold is necessary (but not sufficient —
   * band must not be Low, knowledge must pass, not suppressed).
   *
   * Mobile uses a slightly higher bar (§9.2): fewer, more certain interruptions
   * on a small screen. This is ONE tuning constant, not a separate codebase.
   */
  speakThreshold: {
    desktop: 0.52,
    mobile: 0.59,
    tablet: 0.55,
  },

  /** readinessScore mapping (§7.3). */
  readinessScore: { cold: 0, warm: 0.5, hot: 1.0 } as Record<Readiness, number>,

  /** Interruption fatigue (§7.3): rises 0.4 per prior interruption, capped at 1. */
  fatiguePerInterruption: 0.4,

  /** Cooldown: minimum ms between two interruptions (mirrors config/policy.ts). */
  cooldownMs: 25_000,

  /** Frequency budget: max interruptions per session (MVP is deliberately small). */
  maxInterruptionsPerSession: 2,

  /**
   * Fatigue decay half-life (ms). Annoyance lingers longer than attention, so
   * this is longer than the confidence half-life (5 min vs 45 s).
   */
  fatigueHalfLifeMs: 300_000,
} as const;
