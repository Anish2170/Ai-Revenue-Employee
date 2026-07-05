/**
 * The Sprint 4 acceptance corpus (§11.5) — 8 representative scenarios as
 * recorded semantic-event sequences with the decision we expect.
 *
 * The three SILENCES (window-shopper, distracted, returning-support-no-sell)
 * are the most important tests: they guard the non-negotiables a chatbot fails.
 *
 * Timings are monotonic ms since session start. `now` is the evaluation instant.
 * Kept within a few half-lives so recency stays meaningful.
 */
import type {
  BusinessObjective,
  PerceptionContext,
  SemanticEvent,
  Surface,
  Goal,
  Readiness,
  ConfidenceBand,
  BrainAction,
  BehaviourLabel,
} from '../types.js';

export interface Scenario {
  name: string;
  events: SemanticEvent[];
  now: number;
  surface: Surface;
  context: PerceptionContext;
  objective: BusinessObjective;
  expect: {
    dominant?: BehaviourLabel;
    goal?: Goal;
    readiness?: Readiness;
    band?: ConfidenceBand;
    action: BrainAction;
    suppressedBy?: string | null;
  };
}

const fresh: PerceptionContext = {
  priorInterruptions: 0,
  lastInterruptionTs: null,
  dismissed: false,
  returning: false,
};

const bookDemo: BusinessObjective = { key: 'book_demo', goalValue: 0.9, isSupport: false };
const bookAppt: BusinessObjective = { key: 'book_appointment', goalValue: 0.85, isSupport: false };
const sellProduct: BusinessObjective = { key: 'sell_product', goalValue: 0.8, isSupport: false };
const support: BusinessObjective = { key: 'support', goalValue: 0.4, isSupport: true };

function ev(type: SemanticEvent['type'], zone: SemanticEvent['zone'], ts: number, intensity = 0.8, surface: Surface = 'desktop'): SemanticEvent {
  return { type, zone, intensity, ts, surface };
}

export const SCENARIOS: Scenario[] = [
  // 1. Price-wall (SaaS, desktop) → speak, evaluate-price/warm.
  {
    name: 'price-wall',
    surface: 'desktop',
    context: fresh,
    objective: bookDemo,
    now: 40_000,
    events: [
      ev('content_dwell', 'pricing', 10_000, 0.9),
      ev('pricing_focus', 'pricing', 18_000, 0.9),
      ev('zone_revisit', 'pricing', 28_000, 0.9),
      ev('pricing_focus', 'pricing', 36_000, 0.9),
    ],
    expect: { dominant: 'PriceSensitive', goal: 'EvaluatePrice', readiness: 'warm', action: 'speak' },
  },

  // 2. Nervous first-timer (dentist, desktop) → trust-seeking, speak.
  {
    name: 'nervous-first-timer',
    surface: 'desktop',
    context: fresh,
    objective: bookAppt,
    now: 50_000,
    events: [
      ev('content_dwell', 'trust', 15_000, 0.9),
      ev('content_dwell', 'faq', 25_000, 0.85),
      ev('zone_revisit', 'trust', 38_000, 0.9),
      ev('content_dwell', 'trust', 47_000, 0.9),
    ],
    expect: { dominant: 'TrustSeeking', action: 'speak' },
  },

  // 3. Cart hesitator (e-com) → ready then stall → hot, speak.
  {
    name: 'cart-hesitator',
    surface: 'desktop',
    context: fresh,
    objective: sellProduct,
    now: 30_000,
    events: [
      ev('cta_engage', 'cta', 12_000, 0.9),
      ev('form_start', 'contact', 18_000, 0.9),
      ev('form_stall', 'contact', 27_000, 0.9),
    ],
    expect: { readiness: 'hot', action: 'speak' },
  },

  // 4. Toothache urgent (dentist, mobile) → ready/hot, speak (mobile higher bar still cleared).
  {
    name: 'toothache-urgent-mobile',
    surface: 'mobile',
    context: fresh,
    objective: bookAppt,
    now: 20_000,
    events: [
      ev('content_dwell', 'product', 5_000, 0.9, 'mobile'),
      ev('cta_proximity', 'cta', 12_000, 0.9, 'mobile'),
      ev('cta_engage', 'cta', 18_000, 0.95, 'mobile'),
    ],
    expect: { readiness: 'hot', action: 'speak' },
  },

  // 5. Exit with real intent (gym) → price-sensitive + exit, still speak once.
  {
    name: 'exit-with-intent',
    surface: 'desktop',
    context: fresh,
    objective: bookAppt,
    now: 34_000,
    events: [
      ev('content_dwell', 'pricing', 12_000, 0.9),
      ev('pricing_focus', 'pricing', 20_000, 0.9),
      ev('zone_revisit', 'pricing', 30_000, 0.9),
      ev('exit_signal', 'other', 33_000, 0.9),
    ],
    expect: { action: 'speak' },
  },

  // 6. SILENCE — window-shopper: fast, shallow, no depth → browsing/cold → silent.
  {
    name: 'window-shopper-silent',
    surface: 'desktop',
    context: fresh,
    objective: sellProduct,
    now: 15_000,
    events: [
      ev('content_dwell', 'other', 3_000, 0.2),
      ev('content_dwell', 'other', 8_000, 0.2),
      ev('content_dwell', 'other', 13_000, 0.2),
    ],
    expect: { action: 'silent' },
  },

  // 7. SILENCE — distracted: some prior interest, then idle → suppressed.
  {
    name: 'distracted-silent',
    surface: 'desktop',
    context: fresh,
    objective: bookDemo,
    now: 60_000,
    events: [
      ev('content_dwell', 'pricing', 10_000, 0.8),
      ev('pricing_focus', 'pricing', 18_000, 0.8),
      ev('idle', 'other', 40_000, 1.0),
    ],
    expect: { action: 'silent', suppressedBy: 'distracted' },
  },

  // 8. SILENCE — returning support user: never push a sales CTA.
  {
    name: 'returning-support-no-sell',
    surface: 'desktop',
    context: { ...fresh, returning: true },
    objective: support,
    now: 40_000,
    events: [
      ev('content_dwell', 'trust', 12_000, 0.6),
      ev('content_dwell', 'contact', 22_000, 0.6),
      ev('content_dwell', 'faq', 34_000, 0.6),
    ],
    expect: { action: 'silent' },
  },
];
