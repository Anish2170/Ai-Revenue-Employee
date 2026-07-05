/**
 * Behaviour Engine tuning table (§4.3).
 *
 * A single, central place for the deterministic evidence rules that turn the
 * semantic event stream into behaviour-state weights — the same "one place to
 * tune, no code changes" philosophy as config/policy.ts.
 *
 * Each rule says: "when a matching event arrives, add `weight` to `state`,
 * scaled by the event's intensity." Weights then decay (see confidence.config)
 * and are clamped to 0..1 at output.
 */
import type { BehaviourLabel, SemanticType, Zone } from '../types.js';

/** One evidence rule: a matcher + the state/weight it contributes. */
export interface BehaviourRule {
  /** Event type this rule reacts to. */
  type: SemanticType;
  /** Optional zone constraint; when set the event's zone must match. */
  zone?: Zone;
  /** State this rule feeds. */
  state: BehaviourLabel;
  /** Base weight added (before intensity scaling), 0..1. */
  weight: number;
}

/**
 * The evidence rules. Deliberately small and readable — this IS the behaviour
 * model for Sprint 4.1. A single event may feed several states (mixtures).
 */
export const BEHAVIOUR_RULES: readonly BehaviourRule[] = [
  // Attention / research
  { type: 'content_dwell', zone: 'product', state: 'Researching', weight: 0.35 },
  { type: 'content_dwell', zone: 'faq', state: 'Researching', weight: 0.4 },
  { type: 'content_dwell', zone: 'trust', state: 'TrustSeeking', weight: 0.5 },
  { type: 'content_dwell', zone: 'contact', state: 'TrustSeeking', weight: 0.25 },
  { type: 'content_dwell', zone: 'other', state: 'Browsing', weight: 0.2 },

  // Price sensitivity
  { type: 'pricing_focus', state: 'PriceSensitive', weight: 0.5 },
  { type: 'content_dwell', zone: 'pricing', state: 'PriceSensitive', weight: 0.4 },
  { type: 'zone_revisit', zone: 'pricing', state: 'PriceSensitive', weight: 0.45 },

  // Comparison — revisiting decision zones is the tell
  { type: 'zone_revisit', zone: 'pricing', state: 'Comparing', weight: 0.35 },
  { type: 'zone_revisit', zone: 'product', state: 'Comparing', weight: 0.45 },
  { type: 'zone_revisit', zone: 'faq', state: 'Comparing', weight: 0.2 },

  // Hesitation — hand hovering, stalled, looping
  { type: 'cta_proximity', state: 'Hesitating', weight: 0.5 },
  { type: 'form_stall', state: 'Hesitating', weight: 0.45 },

  // Readiness — decisive action signals
  { type: 'cta_engage', state: 'Ready', weight: 0.7 },
  { type: 'form_start', state: 'Ready', weight: 0.55 },
  { type: 'content_dwell', zone: 'cta', state: 'Ready', weight: 0.25 },

  // Distraction — presence lost
  { type: 'idle', state: 'Distracted', weight: 0.8 },
];

/**
 * Trajectory classification: which states count as "buying-funnel forward"
 * vs "cooling". Used to derive warming/cooling/flat from the state sequence.
 */
export const FORWARD_STATES: readonly BehaviourLabel[] = ['Comparing', 'PriceSensitive', 'Hesitating', 'Ready'];
export const BACKWARD_STATES: readonly BehaviourLabel[] = ['Distracted', 'Browsing'];

/** Behaviour-engine window/settings. */
export const BEHAVIOUR_CONFIG = {
  /**
   * How many of the most-recent dominant-state samples to inspect for
   * trajectory. Small: we want *recent* direction, not whole-session history.
   */
  trajectoryWindow: 4,
  /**
   * Minimum dominant-weight delta to call a trajectory warming/cooling rather
   * than flat. Avoids reading noise as momentum.
   */
  trajectoryEpsilon: 0.1,
} as const;
