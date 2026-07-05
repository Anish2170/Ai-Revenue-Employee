/**
 * Sprint 4 — shared intelligence types.
 *
 * These are the contracts between the perception layers described in
 * docs/SPRINT-4-INTELLIGENCE-ARCHITECTURE.md:
 *
 *   SemanticEvent[]  →  Behaviour Engine  →  BehaviourState
 *                    →  Intent Engine     →  IntentRead
 *                    →  Confidence        →  number (+band)
 *                    →  Sales Brain       →  SalesDecision (+ SalesDecisionTrace)
 *
 * HARD RULE (non-negotiable #3): raw events never leave this backend for the
 * LLM. Only the compact summaries below are ever eligible to reach a prompt.
 *
 * Everything here is deterministic-code territory — no LLM, no I/O, no Date
 * captured implicitly (callers pass `now` so the engines stay pure/testable).
 */

// ---------------------------------------------------------------------------
// §3.1 Semantic event schema (device-agnostic; the widget already normalized it)
// ---------------------------------------------------------------------------

/**
 * Semantic zones on the customer's site. Resolved at the widget edge from the
 * site's own structure (the RAG crawl knows which section is pricing/faq/etc.).
 * Closed enum: ingest rejects anything else (§10.4).
 */
export const ZONES = ['pricing', 'faq', 'cta', 'trust', 'product', 'contact', 'other'] as const;
export type Zone = (typeof ZONES)[number];

/**
 * The 8 MVP semantic event types (§3.2). Deferred types (search_or_filter,
 * content_velocity, …) are intentionally absent — they slot in additively later.
 */
export const SEMANTIC_TYPES = [
  'content_dwell',
  'zone_revisit',
  'pricing_focus',
  'cta_proximity',
  'cta_engage',
  'form_start',
  'form_stall',
  'exit_signal',
  'idle',
  'resume',
] as const;
export type SemanticType = (typeof SEMANTIC_TYPES)[number];

/** Which physical surface produced the event. METADATA ONLY — never branched on above the edge. */
export const SURFACES = ['desktop', 'mobile', 'tablet'] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * One normalized, device-agnostic behavioural signal. This is the ONLY thing the
 * widget sends up; the backend never sees raw mouse/scroll/touch events.
 */
export interface SemanticEvent {
  /** Semantic type, not a DOM event. */
  type: SemanticType;
  /** Semantic zone the event happened in. */
  zone: Zone;
  /** Normalized magnitude 0..1 (e.g. dwell length, proximity closeness). */
  intensity: number;
  /** Monotonic milliseconds since session start (NOT wall-clock epoch). */
  ts: number;
  /** Physical surface — metadata for tuning only (§8/§9). */
  surface: Surface;
}

// ---------------------------------------------------------------------------
// §4 Behaviour Engine output
// ---------------------------------------------------------------------------

/** The 8 MVP behaviour states (§4.2). Not mutually exclusive; humans are mixtures. */
export const BEHAVIOUR_LABELS = [
  'Browsing',
  'Researching',
  'Comparing',
  'PriceSensitive',
  'TrustSeeking',
  'Hesitating',
  'Ready',
  'Distracted',
] as const;
export type BehaviourLabel = (typeof BEHAVIOUR_LABELS)[number];

/** Direction the dominant behaviour is moving over recent windows. */
export type Trajectory = 'warming' | 'cooling' | 'flat';

/** Whether the read is settled or flickering (discounts confidence when volatile). */
export type Stability = 'settled' | 'volatile';

/**
 * The weighted behavioural hypothesis. NEVER contains raw events, goals, or copy.
 * Weights are unbounded-in-principle accumulators clamped to 0..1 at output.
 */
export interface BehaviourState {
  /** Weighted state vector — sparse; only present states are listed. */
  vector: Partial<Record<BehaviourLabel, number>>;
  /** Highest-weight state (ties broken by BEHAVIOUR_LABELS order for determinism). */
  dominant: BehaviourLabel;
  /** Weight of the dominant state, 0..1. */
  dominantWeight: number;
  trajectory: Trajectory;
  stability: Stability;
}

// ---------------------------------------------------------------------------
// §5 Intent Engine output — Goal and Readiness are SEPARATE axes
// ---------------------------------------------------------------------------

/** The 6 MVP goals (§5.1). What the visitor is trying to accomplish. */
export const GOALS = ['Learn', 'Compare', 'EvaluatePrice', 'BuyBook', 'GetSupport', 'Undecided'] as const;
export type Goal = (typeof GOALS)[number];

/** How close to acting the visitor is — an axis INDEPENDENT of goal (§5.2). */
export type Readiness = 'cold' | 'warm' | 'hot';

/** A runner-up goal and its weight, so the Brain can reason about doubt. */
export interface GoalAlternative {
  goal: Goal;
  weight: number;
}

export interface IntentRead {
  /** Best-fit goal. */
  goal: Goal;
  /** Readiness — separate axis from goal. */
  readiness: Readiness;
  /** Runner-up goals (may be empty), sorted desc by weight. */
  alternatives: GoalAlternative[];
  /** True when the top two goals are within a small margin — do not guess. */
  conflict: boolean;
  /** Short human reason for the trace. */
  reason: string;
}

// ---------------------------------------------------------------------------
// §6 Confidence
// ---------------------------------------------------------------------------

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** The four confidence inputs (§6.1), each 0..1, exposed for the trace/debugging. */
export interface ConfidenceInputs {
  /** Evidence — corroborating independent signals, saturating. */
  E: number;
  /** Consistency — do behaviour/trajectory/intent agree? */
  C: number;
  /** Stability — settled vs volatile. */
  S: number;
  /** Recency — freshness of the newest supporting evidence. */
  R: number;
}

export interface ConfidenceResult {
  /** Final scalar 0..1 = E·C·S·R. */
  score: number;
  band: ConfidenceBand;
  inputs: ConfidenceInputs;
}

// ---------------------------------------------------------------------------
// §7 Sales Brain
// ---------------------------------------------------------------------------

/** The abstract action the Brain decides on. In shadow mode we only ever log it. */
export type BrainAction = 'speak' | 'silent';

/**
 * Per-visitor perception context the Brain needs beyond the current event batch.
 * Sourced from the server-side session store (§3.5). Kept minimal for Sprint 4.1.
 */
export interface PerceptionContext {
  /** Interruptions already spent this session (drives fatigue, §7.3). */
  priorInterruptions: number;
  /** Monotonic ms of the last interruption, or null. Drives cooldown + fatigue decay. */
  lastInterruptionTs: number | null;
  /** Whether the visitor explicitly dismissed us this session (§7.4). */
  dismissed: boolean;
  /** Returning visitor (from the first-party token). Only READ by the goal layer. */
  returning: boolean;
}

/**
 * The business objective for this tenant (§8). Sets Value() in the policy and,
 * later, the CTA/tone library. In Sprint 4.1 only `goalValue` + `key` are used.
 */
export interface BusinessObjective {
  /** Stable key, e.g. "book_demo". */
  key: string;
  /** How much a successful outcome is worth, 0..1 — scales the interrupt appetite. */
  goalValue: number;
  /** True for support-type goals: never push a sales CTA at a returning customer. */
  isSupport: boolean;
}

/** The decision the Brain produces. In shadow mode `action` is logged, not enacted. */
export interface SalesDecision {
  action: BrainAction;
  /** Aggregate score from the heuristic policy (§7.2). */
  speakScore: number;
  /** Which suppression rule forced silence, if any (§7.4). */
  suppressedBy: string | null;
  /** One human sentence explaining the decision. */
  because: string;
  /** Full structured trace for debugging / A-B / future training. */
  trace: SalesDecisionTrace;
}

/**
 * The reason trace (§7.5). Extends the spirit of the existing dev-only
 * DecisionTrace with the full perception picture. This is the debugging surface,
 * the A/B unit, the client trust story, and the future training signal — one object.
 */
export interface SalesDecisionTrace {
  behaviour: BehaviourState;
  intent: IntentRead;
  confidence: ConfidenceResult;
  /** Breakdown of the speakScore terms for transparency. */
  policy: {
    wConf: number;
    wReady: number;
    wValue: number;
    wFatigue: number;
    wBad: number;
    readinessScore: number;
    goalValue: number;
    interruptionFatigue: number;
    badMomentPenalty: number;
    speakScore: number;
    threshold: number;
  };
  suppressedBy: string | null;
  action: BrainAction;
  /** Shadow mode flag — true means the decision was logged, not enacted. */
  shadow: boolean;
}
