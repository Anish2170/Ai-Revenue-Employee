/** Tests for Sprint 4.2 component 7: popup generation and safe pipeline composition. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generatePopup } from '../popupGeneration.js';
import { generateSafePopup } from '../popupPipeline.js';
import { validatePopupResponse } from '../responseValidation.js';
import { perceive } from '../perceive.js';
import { buildConversationStrategy } from '../conversationStrategy.js';
import { SCENARIOS } from './fixtures.js';
import type { BusinessActionConfig } from '../../business-actions/action.types.js';
import type { BusinessInstructions, RetrievedChunk } from '../../context/types.js';
import type { BusinessObjective, SalesDecision } from '../types.js';

const instructions: BusinessInstructions = {
  businessName: 'Creovix AI',
  tone: 'Professional, helpful, and concise.',
  alwaysBookDemo: false,
  avoidDiscounts: true,
  language: 'English',
};

const knowledgeContent = 'Creovix offers custom pricing based on workflow scope and integrations.';

const enabledActions: BusinessActionConfig[] = [
  { actionId: 'pricing', label: 'View Pricing', destinationType: 'URL', destination: 'https://creovix.test/pricing', enabled: true },
  { actionId: 'book_demo', label: 'Book Demo', destinationType: 'URL', destination: 'https://creovix.test/demo', enabled: true },
];

function scenarioDecision(name = 'price-wall'): { decision: SalesDecision; objective: BusinessObjective } {
  const scenario = SCENARIOS.find((s) => s.name === name);
  if (!scenario) throw new Error(`missing scenario ${name}`);
  return {
    decision: perceive({
      events: scenario.events,
      now: scenario.now,
      context: scenario.context,
      objective: scenario.objective,
      surface: scenario.surface,
    }),
    objective: scenario.objective,
  };
}

function retrievedChunk(content = knowledgeContent): RetrievedChunk {
  return {
    id: 'pricing-1',
    url: '/pricing',
    page: '/pricing',
    pageType: 'pricing',
    section: 'pricing',
    heading: 'Pricing Plans',
    title: 'Pricing',
    language: 'English',
    hash: 'hash',
    lastCrawled: '2026-07-05T00:00:00.000Z',
    content,
    score: 0.91,
  };
}

function rawPopup(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Pricing that fits your workflow',
    body: knowledgeContent,
    tone: 'reassuring',
    popupType: 'pricing',
    ...overrides,
  };
}

test('popupGeneration: produces a popup only from validated language', () => {
  const { decision, objective } = scenarioDecision();
  const strategy = buildConversationStrategy({ decision, objective });
  assert.ok(strategy);

  const validation = validatePopupResponse({
    llm: { ok: true, raw: rawPopup(), promptVersion: 'popup-v1' },
    strategy,
    knowledge: {
      query: 'pricing',
      knowledgeAvailable: true,
      unavailableReason: null,
      scores: [0.91],
      chunks: [{ ...retrievedChunk(), score: 0.91 }],
    },
    instructions,
    enabledActions,
  });

  const result = generatePopup({ validation, strategy });

  assert.equal(result.ok, true);
  assert.equal(result.popup.source, 'validated_llm');
  assert.equal(result.popup.strategy, 'ReducePriceAnxiety');
  assert.equal(result.popup.ctaIntent, 'discuss_pricing');
  assert.equal(result.popup.title, 'Pricing that fits your workflow');
});

test('popupGeneration: suppresses when response validation failed', () => {
  const { decision, objective } = scenarioDecision();
  const strategy = buildConversationStrategy({ decision, objective });
  assert.ok(strategy);

  const validation = validatePopupResponse({
    llm: { ok: true, raw: rawPopup({ body: 'Creovix starts at $99/month.' }), promptVersion: 'popup-v1' },
    strategy,
    knowledge: {
      query: 'pricing',
      knowledgeAvailable: true,
      unavailableReason: null,
      scores: [0.91],
      chunks: [{ ...retrievedChunk(), score: 0.91 }],
    },
    instructions,
    enabledActions,
  });

  const result = generatePopup({ validation, strategy });

  assert.equal(result.ok, false);
  assert.equal(result.suppressed, true);
  assert.ok(result.validationReasons.includes('invented_pricing'));
});

test('popupPipeline: runs the full safe path and returns validated popup payload', async () => {
  const { decision, objective } = scenarioDecision();
  const calls: string[] = [];

  const result = await generateSafePopup(
    {
      decision,
      objective,
      business: { name: 'Creovix AI' },
      instructions,
      businessActions: enabledActions,
    },
    {
      knowledge: {
        retrieveFn: async (query) => {
          calls.push(`knowledge:${query}`);
          return { chunks: [retrievedChunk()], scores: [0.91] };
        },
      },
      llm: {
        available: () => true,
        generateStructured: async () => {
          calls.push('llm');
          return rawPopup();
        },
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.popup.popup.source, 'validated_llm');
  assert.deepEqual(result.trace.stages, ['strategy', 'knowledge', 'safety', 'prompt', 'llm', 'response_validation', 'popup_generation']);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], 'llm');
});

test('popupPipeline: stops before prompt and LLM when knowledge is missing', async () => {
  const { decision, objective } = scenarioDecision();
  let llmCalled = false;

  const result = await generateSafePopup(
    {
      decision,
      objective,
      business: { name: 'Creovix AI' },
      instructions,
      businessActions: enabledActions,
    },
    {
      knowledge: {
        retrieveFn: async () => ({ chunks: [], scores: [] }),
      },
      llm: {
        available: () => true,
        generateStructured: async () => {
          llmCalled = true;
          return rawPopup();
        },
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.stoppedAt, 'safety');
  assert.match(result.reason, /missing_knowledge/);
  assert.equal(llmCalled, false);
  assert.deepEqual(result.trace.stages, ['strategy', 'knowledge', 'safety']);
});

test('popupPipeline: stops at response validation when LLM invents unsupported copy', async () => {
  const { decision, objective } = scenarioDecision();

  const result = await generateSafePopup(
    {
      decision,
      objective,
      business: { name: 'Creovix AI' },
      instructions,
      businessActions: enabledActions,
    },
    {
      knowledge: {
        retrieveFn: async () => ({ chunks: [retrievedChunk()], scores: [0.91] }),
      },
      llm: {
        available: () => true,
        generateStructured: async () => rawPopup({ body: 'Creovix is SOC 2 certified and starts at $99/month.' }),
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.stoppedAt, 'response_validation');
  assert.match(result.reason, /invented_pricing/);
  assert.ok(result.popup);
  assert.equal(result.popup.ok, false);
  assert.equal(result.popup.suppressed, true);
});

