/** Tests for Sprint 4.2 component 4: pre-LLM safety gate. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { perceive } from '../perceive.js';
import { buildConversationStrategy, type ConversationStrategy } from '../conversationStrategy.js';
import { validatePreLlmSafety } from '../safetyLayer.js';
import { SCENARIOS } from './fixtures.js';
import type { BusinessInstructions } from '../../context/types.js';
import type { StrategyKnowledgeResult } from '../knowledgeRetrieval.js';
import type { SalesDecision } from '../types.js';

const instructions: BusinessInstructions = {
  businessName: 'Creovix AI',
  tone: 'Professional, helpful, and concise.',
  alwaysBookDemo: false,
  avoidDiscounts: true,
  language: 'English',
};

function fixture(name: string) {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`missing scenario ${name}`);
  const decision = perceive({
    events: scenario.events,
    now: scenario.now,
    context: scenario.context,
    objective: scenario.objective,
    surface: scenario.surface,
  });
  const strategy = buildConversationStrategy({ decision, objective: scenario.objective });
  return { scenario, decision, strategy };
}

function knowledge(overrides: Partial<StrategyKnowledgeResult> = {}): StrategyKnowledgeResult {
  return {
    query: 'pricing value demo',
    knowledgeAvailable: true,
    unavailableReason: null,
    scores: [0.9],
    chunks: [
      {
        id: 'k1',
        url: '/pricing',
        page: '/pricing',
        pageType: 'pricing',
        heading: 'Pricing',
        content: 'Pricing is customized to workflow scope and integrations.',
        score: 0.9,
      },
    ],
    ...overrides,
  };
}

function cloneDecision(decision: SalesDecision): SalesDecision {
  return JSON.parse(JSON.stringify(decision)) as SalesDecision;
}

test('safetyLayer: allows a valid speak decision with strategy and knowledge', () => {
  const { decision, strategy } = fixture('price-wall');
  const result = validatePreLlmSafety({ decision, strategy, knowledge: knowledge(), instructions });

  assert.equal(result.ok, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.checked.salesBrainSpeak, true);
  assert.equal(result.checked.knowledgeOk, true);
});

test('safetyLayer: rejects when Sales Brain did not choose speak', () => {
  const { decision, strategy } = fixture('window-shopper-silent');
  const result = validatePreLlmSafety({ decision, strategy, knowledge: knowledge(), instructions });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('sales_brain_not_speak'));
  assert.ok(result.reasons.includes('missing_strategy'));
});

test('safetyLayer: rejects low confidence even if action was mutated to speak', () => {
  const { decision, strategy } = fixture('price-wall');
  const low = cloneDecision(decision);
  low.trace.confidence = { score: 0.2, band: 'low', inputs: low.trace.confidence.inputs };

  const result = validatePreLlmSafety({ decision: low, strategy, knowledge: knowledge(), instructions });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('low_confidence'));
});

test('safetyLayer: rejects missing knowledge', () => {
  const { decision, strategy } = fixture('price-wall');
  const result = validatePreLlmSafety({
    decision,
    strategy,
    knowledge: knowledge({ knowledgeAvailable: false, chunks: [], scores: [], unavailableReason: 'no_relevant_knowledge' }),
    instructions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('missing_knowledge'));
});

test('safetyLayer: rejects CTA intent that does not match strategy', () => {
  const { decision, strategy } = fixture('price-wall');
  assert.ok(strategy);
  const badStrategy: ConversationStrategy = { ...strategy, ctaIntent: 'offer_support' };

  const result = validatePreLlmSafety({ decision, strategy: badStrategy, knowledge: knowledge(), instructions });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('cta_not_allowed'));
});

test('safetyLayer: rejects business policy mismatch for support objective', () => {
  const { decision, strategy } = fixture('price-wall');
  assert.ok(strategy);
  const supportMismatch: ConversationStrategy = {
    ...strategy,
    business: { ...strategy.business, isSupport: true },
  };

  const result = validatePreLlmSafety({ decision, strategy: supportMismatch, knowledge: knowledge(), instructions });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('business_policy'));
});

test('safetyLayer: tenant CTA allowlist can narrow otherwise valid strategy', () => {
  const { decision, strategy } = fixture('price-wall');
  const result = validatePreLlmSafety({
    decision,
    strategy,
    knowledge: knowledge(),
    instructions,
    allowedCtaIntents: ['book_demo'],
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('cta_not_allowed'));
});