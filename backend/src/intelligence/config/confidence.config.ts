/**
 * Confidence-system constants (§6).
 *
 * confidence = E · C · S · R   (multiplicative — any weak/conflicting factor
 * pulls the whole score down; see §6.2 for the rationale).
 *
 * All magic numbers in the confidence math live here so they can be tuned per
 * vertical without touching the arithmetic.
 */
export const CONFIDENCE_CONFIG = {
  /**
   * Evidence saturation constant `k` in E = 1 − exp(−k·n).
   * k = 0.5 gives n=1→0.39, n=3→0.78, n=5→0.92 (the worked example in §6.2).
   */
  evidenceK: 0.5,

  /**
   * Decay half-life (ms) for both behaviour-evidence decay and the recency
   * factor R = 0.5 ^ (age / HALF_LIFE). 45s: attention fades on this order.
   */
  halfLifeMs: 45_000,

  /** Consistency penalties (§6.2), subtracted from C = 1 − penalty (clamped ≥ 0). */
  penalties: {
    /** Top two goals are within the conflict margin. */
    intentConflict: 0.4,
    /** Trajectory contradicts the dominant state (e.g. Ready but cooling/exit). */
    trajectoryContradiction: 0.3,
  },

  /** Stability multiplier S (§6.2). */
  stability: {
    settled: 1.0,
    volatile: 0.6,
  },

  /** Band thresholds (§6.4). */
  bands: {
    /** ≥ high → "high": act with a specific, intent-matched message. */
    high: 0.72,
    /** ≥ medium (and < high) → "medium": probe only. Below → "low": stay silent. */
    medium: 0.45,
  },
} as const;
