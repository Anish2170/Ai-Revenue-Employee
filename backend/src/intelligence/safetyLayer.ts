/**
 * Pre-LLM Safety Layer (Sprint 4.2 component 4).
 *
 * This deterministic gate runs after Conversation Strategy + Knowledge Retrieval
 * and before any LLM call. It does not generate language and does not decide
 * whether to interrupt; it verifies that the Sprint 4.1 Sales Brain decision is
 * still safe to turn into a prompt.
 */
import type { BusinessInstructions } from '../context/types.js';
import type { SalesDecision } from './types.js';
import type { ConversationStrategy, ConversationStrategyKind, StrategyCtaIntent } from './conversationStrategy.js';
import type { StrategyKnowledgeResult } from './knowledgeRetrieval.js';

export type SafetyRejectReason =
  | 'sales_brain_not_speak'
  | 'low_confidence'
  | 'missing_strategy'
  | 'missing_knowledge'
  | 'cta_not_allowed'
  | 'business_policy';

export interface PreLlmSafetyInput {
  decision: SalesDecision;
  strategy: ConversationStrategy | null;
  knowledge: StrategyKnowledgeResult | null;
  instructions: BusinessInstructions;
  /** Optional narrower allowlist supplied by a future tenant/business policy. */
  allowedCtaIntents?: StrategyCtaIntent[];
}

export interface PreLlmSafetyResult {
  ok: boolean;
  reasons: SafetyRejectReason[];
  checked: {
    salesBrainSpeak: boolean;
    confidenceOk: boolean;
    strategyOk: boolean;
    knowledgeOk: boolean;
    ctaOk: boolean;
    businessPolicyOk: boolean;
  };
}

const MIN_CONFIDENCE = 0.45;

const CTA_BY_STRATEGY: Record<ConversationStrategyKind, readonly StrategyCtaIntent[]> = {
  Educate: ['learn_more', 'capture_lead'],
  Compare: ['compare_options', 'learn_more', 'capture_lead'],
  ReducePriceAnxiety: ['discuss_pricing', 'capture_lead', 'book_demo'],
  BuildTrust: ['learn_more', 'capture_lead', 'book_demo'],
  BookDemo: ['book_demo'],
  BookAppointment: ['book_appointment'],
  GenerateLead: ['capture_lead', 'book_demo', 'book_appointment'],
  Support: ['offer_support'],
};

export function validatePreLlmSafety(input: PreLlmSafetyInput): PreLlmSafetyResult {
  const reasons: SafetyRejectReason[] = [];
  const salesBrainSpeak = input.decision.action === 'speak' && input.decision.suppressedBy === null;
  if (!salesBrainSpeak) reasons.push('sales_brain_not_speak');

  const confidence = input.decision.trace.confidence;
  const confidenceOk = confidence.band !== 'low' && confidence.score >= MIN_CONFIDENCE;
  if (!confidenceOk) reasons.push('low_confidence');

  const strategyOk = input.strategy !== null;
  if (!strategyOk) reasons.push('missing_strategy');

  const knowledgeOk = input.knowledge !== null && input.knowledge.knowledgeAvailable && input.knowledge.chunks.length > 0;
  if (!knowledgeOk) reasons.push('missing_knowledge');

  const ctaOk = input.strategy ? isCtaAllowed(input.strategy, input.allowedCtaIntents) : true;
  if (input.strategy && !ctaOk) reasons.push('cta_not_allowed');

  const businessPolicyOk = input.strategy ? obeysBusinessPolicy(input.strategy, input.instructions) : true;
  if (input.strategy && !businessPolicyOk) reasons.push('business_policy');

  return {
    ok: reasons.length === 0,
    reasons,
    checked: {
      salesBrainSpeak,
      confidenceOk,
      strategyOk,
      knowledgeOk,
      ctaOk,
      businessPolicyOk,
    },
  };
}

function isCtaAllowed(strategy: ConversationStrategy, allowlist?: StrategyCtaIntent[]): boolean {
  const byStrategy = CTA_BY_STRATEGY[strategy.kind].includes(strategy.ctaIntent);
  if (!byStrategy) return false;
  if (!allowlist) return true;
  return allowlist.includes(strategy.ctaIntent);
}

function obeysBusinessPolicy(strategy: ConversationStrategy, instructions: BusinessInstructions): boolean {
  if (strategy.business.isSupport) {
    return strategy.kind === 'Support' && strategy.ctaIntent === 'offer_support';
  }

  if (instructions.alwaysBookDemo && strategy.visitor.intent.readiness === 'hot') {
    return ['book_demo', 'book_appointment', 'capture_lead', 'discuss_pricing'].includes(strategy.ctaIntent);
  }

  // avoidDiscounts is enforced in prompt/response validation; discussing pricing
  // is still allowed as long as the model does not offer discounts.
  return true;
}