/** Tests for Sprint 4.2 component 6: popup response validation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validatePopupResponse } from '../responseValidation.js';
import { perceive } from '../perceive.js';
import { buildConversationStrategy, type ConversationStrategy } from '../conversationStrategy.js';
import { SCENARIOS } from './fixtures.js';
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
    cta: 'Discuss pricing',
    tone: 'reassuring',
    popupType: 'pricing',
    ...overrides,
  };
}

test('responseValidation: approves grounded popup language matching the strategy', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({ llm: llm(validRaw()), strategy, knowledge: knowledge(), instructions });

  assert.equal(result.ok, true);
  assert.equal(result.popup.title, 'Pricing that fits your workflow');
  assert.equal(result.popup.cta, 'Discuss pricing');
  assert.deepEqual(result.reasons, []);
});

test('responseValidation: fails closed when the LLM adapter failed', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: { ok: false, reason: 'timeout', promptVersion: 'popup-v1' },
    strategy,
    knowledge: knowledge(),
    instructions,
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
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('strategy_mismatch'));
});

test('responseValidation: rejects CTA that ignores the approved intent', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ cta: 'Book demo' })),
    strategy,
    knowledge: knowledge(),
    instructions,
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('cta_not_allowed'));
});
test('responseValidation: accepts chat-style CTA language for lead capture', () => {
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
      cta: 'Book a call',
      tone: 'helpful',
      popupType: 'lead',
    }),
    strategy: leadStrategy,
    knowledge: knowledge('Tell us what you are trying to improve and we can point you in the right direction.'),
    instructions,
  });

  assert.equal(result.ok, true);
  assert.equal(result.popup.cta, 'Book a call');
});


test('responseValidation: accepts common GenerateLead capture_lead CTA variants', () => {
  const { strategy } = fixture();
  const leadStrategy: ConversationStrategy = {
    ...strategy,
    kind: 'GenerateLead',
    tone: 'direct',
    ctaIntent: 'capture_lead',
  };
  const ctas = [
    'Request a Consultation',
    'Claim Gift Code',
    'Get Gift Code',
    'Join Now',
    'Access Details',
    'Unlock Details',
    'Start Now',
    'Get Started',
    'Talk to an Expert',
    'Connect With Us',
    'Send a Message',
    "I'm Interested",
    'Yes, Help Me',
    'Help Me Start',
    'Check Eligibility',
    'Find Out More',
    'Show Me How',
    'Begin Setup',
    'Register Interest',
    'Ask About This',
  ];

  for (const cta of ctas) {
    const result = validatePopupResponse({
      llm: llm({
        title: 'Ready to take the next step?',
        body: 'Share what you need and the team can guide you through the next step.',
        cta,
        tone: 'direct',
        popupType: 'lead',
      }),
      strategy: leadStrategy,
      knowledge: knowledge('Share what you need and the team can guide you through the next step.'),
      instructions,
    });

    assert.equal(result.ok, true, `${cta} should be accepted as capture_lead`);
    assert.equal(result.popup.cta, cta);
  }
});

test('responseValidation: rejects invented pricing amounts', () => {
  const { strategy } = fixture();
  const result = validatePopupResponse({
    llm: llm(validRaw({ body: 'Creovix starts at $99/month for every team.' })),
    strategy,
    knowledge: knowledge('Creovix offers custom pricing based on workflow scope and integrations.'),
    instructions,
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
  });

  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('business_policy'));
});

test('responseValidation: support strategy only accepts support-style CTA and popup type', () => {
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
      cta: 'Get help',
      tone: 'supportive',
      popupType: 'support',
    }),
    strategy: supportStrategy,
    knowledge: knowledge('Our team can help answer questions about the next step.'),
    instructions,
  });

  assert.equal(result.ok, true);
  assert.equal(result.popup.popupType, 'support');
});
