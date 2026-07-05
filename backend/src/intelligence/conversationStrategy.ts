/**
 * Conversation Strategy Layer (Sprint 4.2 component 1).
 *
 * Converts the deterministic Sales Brain output into a communication strategy.
 * This layer never sees raw semantic events and never calls the LLM. It only
 * consumes the safe perception summaries already present on SalesDecision.trace.
 */
import type {
  BehaviourLabel,
  BusinessObjective,
  ConfidenceBand,
  Goal,
  Readiness,
  SalesDecision,
  Trajectory,
} from './types.js';

export const CONVERSATION_STRATEGIES = [
  'Educate',
  'Compare',
  'ReducePriceAnxiety',
  'BuildTrust',
  'BookDemo',
  'BookAppointment',
  'GenerateLead',
  'Support',
] as const;

export type ConversationStrategyKind = (typeof CONVERSATION_STRATEGIES)[number];

export type StrategyTone = 'helpful' | 'consultative' | 'reassuring' | 'direct' | 'supportive';

export type StrategyCtaIntent =
  | 'learn_more'
  | 'compare_options'
  | 'discuss_pricing'
  | 'book_demo'
  | 'book_appointment'
  | 'capture_lead'
  | 'offer_support';

export interface ConversationStrategy {
  /** High-level communication plan. This is what the prompt receives. */
  kind: ConversationStrategyKind;
  /** Tone guidance for language generation. */
  tone: StrategyTone;
  /** The CTA family later safety checks may allow or reject. */
  ctaIntent: StrategyCtaIntent;
  /** One sentence explaining why this strategy was selected. */
  reason: string;
  /** Compact safe summaries for prompt/retrieval layers. Never raw events. */
  visitor: {
    behaviour: {
      dominant: BehaviourLabel;
      trajectory: Trajectory;
    };
    intent: {
      goal: Goal;
      readiness: Readiness;
      conflict: boolean;
    };
    confidence: {
      score: number;
      band: ConfidenceBand;
    };
  };
  business: {
    objectiveKey: string;
    goalValue: number;
    isSupport: boolean;
  };
}

export interface ConversationStrategyInput {
  /** Must already be produced by the deterministic Sales Brain. */
  decision: SalesDecision;
  objective: BusinessObjective;
}

/**
 * Build a strategy only after Sales Brain chose to speak. A silent decision has
 * no mouth: downstream layers must not retrieve, prompt, or call an LLM.
 */
export function buildConversationStrategy(input: ConversationStrategyInput): ConversationStrategy | null {
  const { decision, objective } = input;
  if (decision.action !== 'speak' || decision.suppressedBy !== null) return null;

  const { behaviour, intent, confidence } = decision.trace;
  const kind = chooseStrategy(decision, objective);
  const tone = toneFor(kind);
  const ctaIntent = ctaFor(kind, objective);

  return {
    kind,
    tone,
    ctaIntent,
    reason: reasonFor(kind, decision, objective),
    visitor: {
      behaviour: {
        dominant: behaviour.dominant,
        trajectory: behaviour.trajectory,
      },
      intent: {
        goal: intent.goal,
        readiness: intent.readiness,
        conflict: intent.conflict,
      },
      confidence: {
        score: confidence.score,
        band: confidence.band,
      },
    },
    business: {
      objectiveKey: objective.key,
      goalValue: objective.goalValue,
      isSupport: objective.isSupport,
    },
  };
}

function chooseStrategy(decision: SalesDecision, objective: BusinessObjective): ConversationStrategyKind {
  const { behaviour, intent } = decision.trace;
  const key = objective.key.toLowerCase();

  if (objective.isSupport || intent.goal === 'GetSupport') return 'Support';

  // Psychological reads win before generic business goals.
  if (behaviour.dominant === 'PriceSensitive' || intent.goal === 'EvaluatePrice') {
    return 'ReducePriceAnxiety';
  }
  if (behaviour.dominant === 'TrustSeeking') return 'BuildTrust';
  if (behaviour.dominant === 'Comparing' || intent.goal === 'Compare') return 'Compare';

  if (key.includes('appointment')) return 'BookAppointment';
  if (key.includes('demo')) return 'BookDemo';
  if (intent.goal === 'BuyBook' || behaviour.dominant === 'Ready') return 'GenerateLead';
  if (intent.goal === 'Learn' || behaviour.dominant === 'Researching') return 'Educate';

  return 'GenerateLead';
}

function toneFor(kind: ConversationStrategyKind): StrategyTone {
  switch (kind) {
    case 'ReducePriceAnxiety':
    case 'BuildTrust':
      return 'reassuring';
    case 'BookDemo':
    case 'BookAppointment':
    case 'GenerateLead':
      return 'direct';
    case 'Support':
      return 'supportive';
    case 'Compare':
      return 'consultative';
    case 'Educate':
    default:
      return 'helpful';
  }
}

function ctaFor(kind: ConversationStrategyKind, objective: BusinessObjective): StrategyCtaIntent {
  switch (kind) {
    case 'ReducePriceAnxiety':
      return 'discuss_pricing';
    case 'BuildTrust':
    case 'Educate':
      return 'learn_more';
    case 'Compare':
      return 'compare_options';
    case 'BookDemo':
      return 'book_demo';
    case 'BookAppointment':
      return 'book_appointment';
    case 'Support':
      return 'offer_support';
    case 'GenerateLead':
    default:
      if (objective.key.toLowerCase().includes('demo')) return 'book_demo';
      if (objective.key.toLowerCase().includes('appointment')) return 'book_appointment';
      return 'capture_lead';
  }
}

function reasonFor(kind: ConversationStrategyKind, decision: SalesDecision, objective: BusinessObjective): string {
  const { behaviour, intent, confidence } = decision.trace;
  return `${kind} selected from ${behaviour.dominant} behaviour, ${intent.goal}/${intent.readiness} intent, ${confidence.band} confidence, and ${objective.key} objective.`;
}