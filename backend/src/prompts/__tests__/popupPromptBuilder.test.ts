/** Tests for Sprint 4.2 component 3: structured popup prompt builder. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { popupPromptBuilder } from '../popupPromptBuilder.js';
import { perceive } from '../../intelligence/perceive.js';
import { buildConversationStrategy } from '../../intelligence/conversationStrategy.js';
import type { StrategyKnowledgeResult } from '../../intelligence/knowledgeRetrieval.js';
import { SCENARIOS } from '../../intelligence/__tests__/fixtures.js';
import type { BusinessInstructions } from '../../context/types.js';

function buildInput(knowledge?: Partial<StrategyKnowledgeResult>) {
  const scenario = SCENARIOS.find((s) => s.name === 'price-wall');
  if (!scenario) throw new Error('missing price-wall scenario');

  const decision = perceive({
    events: scenario.events,
    now: scenario.now,
    context: scenario.context,
    objective: scenario.objective,
    surface: scenario.surface,
  });
  const strategy = buildConversationStrategy({ decision, objective: scenario.objective });
  if (!strategy) throw new Error('expected strategy');

  const instructions: BusinessInstructions = {
    businessName: 'Creovix AI',
    tone: 'Professional, helpful, and concise.',
    alwaysBookDemo: true,
    avoidDiscounts: true,
    language: 'English',
  };

  const baseKnowledge: StrategyKnowledgeResult = {
    query: 'book_demo ReducePriceAnxiety pricing value faq',
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
        content: 'Creovix offers custom pricing based on workflow scope and integrations.',
        score: 0.91,
      },
    ],
  };

  return {
    business: { name: 'Creovix AI', objectiveKey: scenario.objective.key },
    instructions,
    strategy,
    knowledge: { ...baseKnowledge, ...knowledge },
  };
}

test('popupPromptBuilder: builds required structured sections', () => {
  const prompt = popupPromptBuilder.build(buildInput());
  const titles = prompt.sections.map((s) => s.title);

  assert.deepEqual(titles, [
    'Business',
    'Visitor',
    'Behaviour',
    'Intent',
    'Strategy',
    'Knowledge',
    'Constraints',
    'Output Format',
  ]);
  assert.equal(prompt.version, 'popup-v1');
  assert.match(prompt.system, /deterministic Sales Brain has already decided to speak/);
});

test('popupPromptBuilder: schema is language-only and cannot decide interruption', () => {
  const prompt = popupPromptBuilder.build(buildInput());
  const schemaText = JSON.stringify(prompt.schema);

  assert.match(schemaText, /title/);
  assert.match(schemaText, /body/);
  assert.match(schemaText, /cta/);
  assert.match(schemaText, /popupType/);
  assert.equal(schemaText.includes('showPopup'), false);
  assert.equal(schemaText.includes('confidence'), false);
});

test('popupPromptBuilder: includes strategy, knowledge, and owner policy', () => {
  const prompt = popupPromptBuilder.build(buildInput());

  assert.match(prompt.user, /Approved strategy: ReducePriceAnxiety/);
  assert.match(prompt.user, /CTA intent: discuss_pricing/);
  assert.match(prompt.user, /Creovix offers custom pricing/);
  assert.match(prompt.user, /Do not offer, imply, or mention discounts/);
  assert.match(prompt.user, /Return JSON with exactly these fields/);
});

test('popupPromptBuilder: does not include raw semantic event names', () => {
  const prompt = popupPromptBuilder.build(buildInput());
  const encoded = JSON.stringify(prompt);

  assert.equal(encoded.includes('content_dwell'), false);
  assert.equal(encoded.includes('pricing_focus'), false);
  assert.equal(encoded.includes('zone_revisit'), false);
  assert.equal(encoded.includes('cta_engage'), false);
});

test('popupPromptBuilder: missing knowledge tells model not to fabricate', () => {
  const prompt = popupPromptBuilder.build(
    buildInput({
      knowledgeAvailable: false,
      unavailableReason: 'no_relevant_knowledge',
      chunks: [],
      scores: [],
    }),
  );

  assert.match(prompt.user, /Knowledge available: false/);
  assert.match(prompt.user, /Do not fabricate facts/);
  assert.match(prompt.system, /Use only the provided knowledge/);
});