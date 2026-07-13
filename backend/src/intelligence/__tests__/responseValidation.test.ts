/** Tests for Sprint 4.2 component 6: popup response validation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePopupResponse } from '../responseValidation.js';
import { perceive } from '../perceive.js';
import { buildConversationStrategy, type ConversationStrategy } from '../conversationStrategy.js';
import { SCENARIOS } from './fixtures.js';
import type { BusinessActionConfig } from '../../business-actions/action.types.js';
import type { BusinessInstructions } from '../../context/types.js';
import type { StrategyKnowledgeResult } from '../knowledgeRetrieval.js';
import type { PopupLlmResult } from '../popupLlmAdapter.js';

const instructions: BusinessInstructions = {
  businessName: 'Creovix AI',
  tone: 'Professional, helpful, and concise.',
  alwaysBookDemo: false,
  avoidDiscounts: true,
  language: 'English',
};

const enabledActions: BusinessActionConfig[] = [
  { actionId: 'pricing', label: 'View Pricing', destinationType: 'URL', destination: 'https://creovix.test/pricing', enabled: true },
  { actionId: 'book_demo', label: 'Book Demo', destinationType: 'URL', destination: 'https://creovix.test/demo', enabled: true },
  { actionId: 'schedule_site_visit', label: 'Schedule Site Visit', destinationType: 'URL', destination: 'https://creovix.test/site-visit', enabled: true },
];

function fixture(name = 'price-wall') {
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
  if (!strategy) throw new Error('expected strategy');

  return { scenario, strategy };
}

function knowledge(content = 'Creovix offers custom pricing based on workflow scope and integrations.'): StrategyKnowledgeResult {
  return {
    query: 'pricing value demo',
    knowledgeAvailable: true,
    unavailableReason: null,
    scores: [0.91],
    chunks: [
      {
        id: 'pricing-1',
        url: '/pricing',
        page: '/pricing',
        pageType: 'pricing',
        heading: 'Pricing Plans',
        content,
        score: 0.91,
      },
    ],
  };
}

function llm(raw: unknown): PopupLlmResult {
  return { ok: true, raw, promptVersion: 'popup-v1' };
}

function validRaw(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Pricing that fits your workflow',
    body: 'Creovix uses custom pricing based on workflow scope and integrations.',
    tone: 'reassuring',
    popupType: 'pricing',
    ...overrides,
  };
}

test('responseValidation: applies enabled fallback action when LLM omits a required action', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({ llm: llm(validRaw()), strategy, knowledge: knowledge(), instructions, enabledActions });

  assert.equal(result.ok, true);
  assert.equal(result.popup.title, 'Pricing that fits your workflow');
  assert.equal(result.popup.primaryAction, 'pricing');
  assert.equal(result.actionDebug.expectedAction, true);
  assert.equal(result.actionDebug.fallbackApplied, true);
  assert.equal(result.actionDebug.fallbackUsed, 'pricing');
  assert.equal(result.actionDebug.missingActionReason, 'LLM omitted action');
  assert.deepEqual(result.reasons, []);
});

test('responseValidation: rejects conversion popups when no valid business action exists', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({ llm: llm(validRaw()), strategy, knowledge: knowledge(), instructions, enabledActions: [] });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('missing_business_action'));
  assert.equal(result.fallback.action, 'suppress_popup');
  assert.equal(result.actionDebug.expectedAction, true);
  assert.equal(result.actionDebug.fallbackApplied, false);
  assert.equal(result.actionDebug.missingActionReason, 'LLM omitted action');
});

test('responseValidation: accepts only enabled configured action IDs', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ primaryAction: 'pricing', secondaryAction: 'book_demo' })),
    strategy,
    knowledge: knowledge(),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, true);
  assert.equal(result.popup.primaryAction, 'pricing');
  assert.equal(result.popup.secondaryAction, 'book_demo');
});

test('responseValidation: accepts custom action IDs when configured and enabled', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ primaryAction: 'schedule_site_visit' })),
    strategy,
    knowledge: knowledge(),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, true);
  assert.equal(result.popup.primaryAction, 'schedule_site_visit');
});

test('responseValidation: rejects missing or disabled action IDs', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ primaryAction: 'whatsapp' })),
    strategy,
    knowledge: knowledge(),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('cta_not_allowed'));
});

test('responseValidation: rejects AI-generated CTA labels and URLs', () => {
  const { strategy } = fixture();
  for (const forbidden of [
    { cta: 'Book Demo' },
    { ctaLabel: 'Book Demo' },
    { ctaUrl: 'https://creovix.test/demo' },
    { destination: 'https://creovix.test/demo' },
  ]) {
    const result = validatePopupResponse({
      llm: llm(validRaw(forbidden)),
      strategy,
      knowledge: knowledge(),
      instructions,
      enabledActions,
    });

    assert.equal(result.ok, false, JSON.stringify(forbidden));
    assert.ok(result.reasons.includes('schema_violation'));
  }
});

test('responseValidation: fails closed when the LLM adapter failed', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: { ok: false, reason: 'timeout', promptVersion: 'popup-v1' },
    strategy,
    knowledge: knowledge(),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('llm_failed'));
  assert.equal(result.fallback.action, 'suppress_popup');
});

test('responseValidation: rejects malformed or legacy decision-shaped responses', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm({ showPopup: true, message: 'Hi', cta: 'Chat', confidence: 1 }),
    strategy,
    knowledge: knowledge(),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('schema_violation'));
});

test('responseValidation: rejects strategy and popup type drift', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ tone: 'direct', popupType: 'lead' })),
    strategy,
    knowledge: knowledge(),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('strategy_mismatch'));
});

test('responseValidation: accepts a lead strategy with a configured lead action', () => {
  const { strategy } = fixture();
  const leadStrategy: ConversationStrategy = {
    ...strategy,
    kind: 'GenerateLead',
    tone: 'helpful',
    ctaIntent: 'capture_lead',
  };

  const result = validatePopupResponse({
    llm: llm({
      title: 'Want help choosing the next step?',
      body: 'Tell us what you are trying to improve and we can point you in the right direction.',
      primaryAction: 'book_demo',
      tone: 'helpful',
      popupType: 'lead',
    }),
    strategy: leadStrategy,
    knowledge: knowledge('Tell us what you are trying to improve and we can point you in the right direction.'),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, true);
  assert.equal(result.popup.primaryAction, 'book_demo');
});

test('responseValidation: rejects invented pricing amounts', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ body: 'Creovix starts at $99/month for every team.' })),
    strategy,
    knowledge: knowledge('Creovix offers custom pricing based on workflow scope and integrations.'),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('invented_pricing'));
});

test('responseValidation: rejects invented guarantees', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ body: 'Creovix includes a money-back guarantee for every plan.' })),
    strategy,
    knowledge: knowledge('Creovix offers custom pricing based on workflow scope and integrations.'),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('invented_guarantee'));
});

test('responseValidation: rejects claims not present in knowledge', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ body: 'Creovix is SOC 2 certified and ready for secure workflows.' })),
    strategy,
    knowledge: knowledge('Creovix supports workflow automation for sales teams.'),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('unsupported_claim'));
});

test('responseValidation: rejects invented feature or integration claims', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ body: 'Creovix includes Slack integration and custom pricing based on workflow scope.' })),
    strategy,
    knowledge: knowledge('Creovix offers custom pricing based on workflow scope and integrations.'),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('unsupported_claim'));
});

test('responseValidation: rejects discount language when business policy forbids it', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ body: 'Ask now and we can share a limited-time discount.' })),
    strategy,
    knowledge: knowledge('Creovix offers custom pricing based on workflow scope and integrations.'),
    instructions,
    enabledActions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('business_policy'));
});

test('responseValidation: support strategy can choose only a configured support action', () => {
  const { strategy } = fixture('nervous-first-timer');
  const supportStrategy: ConversationStrategy = {
    ...strategy,
    kind: 'Support',
    tone: 'supportive',
    ctaIntent: 'offer_support',
  };

  const result = validatePopupResponse({
    llm: llm({
      title: 'Need a hand?',
      body: 'Our team can help answer questions about the next step.',
      primaryAction: 'contact_support',
      tone: 'supportive',
      popupType: 'support',
    }),
    strategy: supportStrategy,
    knowledge: knowledge('Our team can help answer questions about the next step.'),
    instructions,
    enabledActions: [
      ...enabledActions,
      { actionId: 'contact_support', label: 'Contact Support', destinationType: 'EMAIL', destination: 'support@creovix.test', enabled: true },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.popup.popupType, 'support');
  assert.equal(result.popup.primaryAction, 'contact_support');
});



test('responseValidation: accepts configured aliases for contact and support actions', () => {
  const { strategy } = fixture();
  const leadStrategy: ConversationStrategy = {
    ...strategy,
    kind: 'GenerateLead',
    tone: 'helpful',
    ctaIntent: 'capture_lead',
  };

  const leadResult = validatePopupResponse({
    llm: llm({
      title: 'Want help choosing the next step?',
      body: 'Tell us what you are trying to improve and we can point you in the right direction.',
      tone: 'helpful',
      popupType: 'lead',
    }),
    strategy: leadStrategy,
    knowledge: knowledge('Tell us what you are trying to improve and we can point you in the right direction.'),
    instructions,
    enabledActions: [{ actionId: 'contact_sales', label: 'Contact Sales', destinationType: 'URL', destination: 'https://creovix.test/contact', enabled: true }],
  });

  assert.equal(leadResult.ok, true);
  assert.equal(leadResult.popup.primaryAction, 'contact_sales');
  assert.equal(leadResult.actionDebug.fallbackApplied, true);
  assert.equal(leadResult.actionDebug.fallbackUsed, 'contact_sales');

  const supportStrategy: ConversationStrategy = {
    ...strategy,
    kind: 'Support',
    tone: 'supportive',
    ctaIntent: 'offer_support',
  };

  const supportResult = validatePopupResponse({
    llm: llm({
      title: 'Need a hand?',
      body: 'Our team can help answer questions about the next step.',
      primaryAction: 'support',
      tone: 'supportive',
      popupType: 'support',
    }),
    strategy: supportStrategy,
    knowledge: knowledge('Our team can help answer questions about the next step.'),
    instructions,
    enabledActions: [{ actionId: 'contact_support', label: 'Contact Support', destinationType: 'EMAIL', destination: 'support@creovix.test', enabled: true }],
  });

  assert.equal(supportResult.ok, true);
  assert.equal(supportResult.popup.primaryAction, 'contact_support');
  assert.equal(supportResult.actionDebug.fallbackApplied, false);
});
