/**
 * Tunable, deterministic thresholds for the rules engine.
 *
 * Kept separate from secrets/env config so business behaviour can be tuned in
 * one place. These drive the pre- and post-LLM gates without touching code.
 */
export const policy = {
  /** Minimum seconds between two /engage evaluations for one visitor. */
  cooldownSeconds: 25,

  /** Hard cap on /engage evaluations per session (cost guard). */
  maxEngagePerSession: 6,

  /**
   * Confidence floor applied AFTER the LLM responds. A decision below this is
   * downgraded to { showPopup: false } in finalizeDecision().
   */
  minConfidence: 0.6,

  /**
   * Pre-LLM eligibility thresholds. A visitor must look "engaged enough" on at
   * least one of these axes before we spend an LLM call. Tuned to skip drive-by
   * visits (e.g. 8s on the homepage) and reward real interest.
   */
  eligibility: {
    /** Seconds on page that alone justify evaluating. */
    minTimeOnPage: 25,
    /** Scroll depth (%) that alone justifies evaluating. */
    minScrollDepth: 60,
    /** A click on any tracked element justifies evaluating. */
    clickIsSignal: true,
    /** Form interaction justifies evaluating. */
    formIsSignal: true,
    /** Exit intent justifies a last-chance evaluation. */
    exitIntentIsSignal: true,
  },
} as const;
