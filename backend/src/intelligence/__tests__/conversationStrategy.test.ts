/**
 * Sprint 4.2 component 1: Conversation Strategy Layer.
 *
 * These tests verify that strategy is derived only after the deterministic Sales
 * Brain has chosen to speak, and that the result contains safe summaries rather
 * than raw semantic events.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { perceive } from '../perceive.js';
import { buildConversationStrategy } from '../conversationStrategy.js';
import { SCENARIOS } from './fixtures.js';

function scenario(name: string) {
  const found = SCENARIOS.find((s) => s.name === name);
  if (!found) throw new Error(`Missing scenario ${name}`);
  return found;
}

function decisionFor(name: string) {
  const s = scenario(name);
  const decision = perceive({
    events: s.events,
    now: s.now,
    context: s.context,
    objective: s.objective,
    surface: s.surface,
  });
  return { scenario: s, decision };
}

test('conversationStrategy: silent Sales Brain decisions produce no strategy', () => {
  const { scenario: s, decision } = decisionFor('window-shopper-silent');
  assert.equal(decision.action, 'silent');
  assert.equal(buildConversationStrategy({ decision, objective: s.objective }), null);
});

test('conversationStrategy: price-sensitive reads reduce price anxiety', () => {
  const { scenario: s, decision } = decisionFor('price-wall');
  const strategy = buildConversationStrategy({ decision, objective: s.objective });

  assert.ok(strategy);
  assert.equal(strategy.kind, 'ReducePriceAnxiety');
  assert.equal(strategy.ctaIntent, 'discuss_pricing');
  assert.equal(strategy.tone, 'reassuring');
  assert.equal(strategy.visitor.behaviour.dominant, 'PriceSensitive');
  assert.equal(strategy.visitor.intent.goal, 'EvaluatePrice');
});

test('conversationStrategy: trust-seeking reads build trust', () => {
  const { scenario: s, decision } = decisionFor('nervous-first-timer');
  const strategy = buildConversationStrategy({ decision, objective: s.objective });

  assert.ok(strategy);
  assert.equal(strategy.kind, 'BuildTrust');
  assert.equal(strategy.ctaIntent, 'learn_more');
  assert.equal(strategy.tone, 'reassuring');
});

test('conversationStrategy: urgent appointment objective books appointment', () => {
  const { scenario: s, decision } = decisionFor('toothache-urgent-mobile');
  const strategy = buildConversationStrategy({ decision, objective: s.objective });

  assert.ok(strategy);
  assert.equal(strategy.kind, 'BookAppointment');
  assert.equal(strategy.ctaIntent, 'book_appointment');
  assert.equal(strategy.visitor.intent.readiness, 'hot');
});

test('conversationStrategy: output contains safe summaries, not raw events', () => {
  const { scenario: s, decision } = decisionFor('cart-hesitator');
  const strategy = buildConversationStrategy({ decision, objective: s.objective });

  assert.ok(strategy);
  const encoded = JSON.stringify(strategy);
  assert.equal(encoded.includes('content_dwell'), false);
  assert.equal(encoded.includes('form_start'), false);
  assert.equal(encoded.includes('form_stall'), false);
  assert.equal(Object.hasOwn(strategy, 'events'), false);
  assert.equal(strategy.business.objectiveKey, s.objective.key);
});