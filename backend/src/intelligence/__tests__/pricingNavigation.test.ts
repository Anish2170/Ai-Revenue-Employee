import assert from 'node:assert/strict';
import test from 'node:test';
import type { BusinessActionConfig } from '../../business-actions/action.types.js';
import { buildActionGraph, extractActionsFromHtml } from '../../business-actions/actionDiscovery.js';
import type { CrawledPage } from '../../context/types.js';
import { mergeBusinessActions } from '../../business-actions/action.service.js';
import { popupPromptBuilder } from '../../prompts/popupPromptBuilder.js';
import { actionPurpose, popupCompatibleActions, resolvePopupAction } from '../popupActionPolicy.js';
import { validatePopupResponse } from '../responseValidation.js';
import { generateSafePopup } from '../popupPipeline.js';
import { buildConversationStrategy } from '../conversationStrategy.js';
import { perceive } from '../perceive.js';
import { SCENARIOS } from './fixtures.js';
import { knowledge } from './phase26Fixtures.js';

const origin = 'https://example.test';
const websiteId = 'pricing-tenant';
const context = { websiteId, websiteUrl: origin, businessName: 'Example' };
const instructions = { businessName: 'Example', websiteUrl: origin, language: 'English', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: true };
const scenario = SCENARIOS.find(s => s.name === 'price-wall')!;
const decision = perceive({ ...scenario });
const strategy = buildConversationStrategy({ decision, objective: scenario.objective })!;
const source = knowledge('Basic plan costs $10.');

function pricing(label = 'Pricing & Financing', destination = origin + '/pricing', source: 'owner' | 'discovered' = 'discovered'): BusinessActionConfig {
  return { actionId: 'pricing', label, destinationType: 'URL', destination, enabled: true,
    authority: { source, websiteId, actionId: 'pricing', label, destinationType: 'URL', destination, confidence: .95 } };
}

function validate(action: BusinessActionConfig, body = 'Need help comparing pricing options?', primaryAction = 'pricing') {
  return validatePopupResponse({
    llm: { ok: true, promptVersion: 'popup-v1', raw: { title: 'Pricing help', body, primaryAction, secondaryAction: '', tone: strategy.tone, popupType: 'pricing' } },
    strategy, knowledge: source, instructions, enabledActions: [action], websiteId, groundingContext: { pagePath: '/pricing' },
  });
}

test('pricing navigation: discovery preserves the safe label and the pipeline accepts it', async () => {
  const page: CrawledPage = { url: origin, path: '/', title: 'Example', text: 'Example pricing navigation.', pageType: 'home', contentHash: 'fixture', lastCrawled: '2026-10-30T00:00:00.000Z' };
  const graph = await buildActionGraph(extractActionsFromHtml('<a href="/pricing">Pricing &amp; Financing</a>', page), {
    generate: async () => { throw Error('Rule-based pricing navigation must not call AI'); },
  });
  const node = graph.nodes.find(node => node.intent === 'pricing');
  assert.ok(node);
  assert.equal(node.preferred.label, 'Pricing & Financing');
  assert.equal(node.preferred.url, origin + '/pricing');
  const action = pricing(node.preferred.label, node.preferred.url);
  action.authority!.confidence = node.preferred.confidence;
  assert.equal(actionPurpose(action, context), 'pricing');
  const result = await generateSafePopup({ decision, objective: scenario.objective, business: { name: 'Example' }, instructions, websiteId, businessActions: [action], pagePath: '/pricing' }, {
    knowledge: { retrieveFn: async () => ({ chunks: source.chunks.map(chunk => ({ ...chunk, title: 'Pricing', section: 'pricing', language: 'English', hash: 'fixture', lastCrawled: '2026-10-30' })), scores: source.scores }) },
    llm: { available: () => true, generateStructured: async req => {
      assert.match(req.user, /pricing: Pricing & Financing/);
      assert.match(req.user, /Primary IDs: \["pricing"\]/);
      return { title: 'Pricing help', body: 'Need help comparing pricing options?', primaryAction: 'pricing', secondaryAction: '', tone: strategy.tone, popupType: 'pricing' };
    } },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.popup.popup.primaryAction, 'pricing');
});

for (const label of ['View Pricing', 'Pricing', 'Pricing & Financing', 'pricing & financing']) {
  test(`pricing navigation: accepts exact navigation label ${label}`, () => {
    assert.equal(validate(pricing(label)).ok, true);
  });
}

test('pricing navigation: omitted model action uses the same verified pricing fallback', () => {
  const result = validate(pricing(), undefined, '');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.popup.primaryAction, 'pricing');
    assert.equal(result.actionDebug.fallbackApplied, true);
  }
});

for (const label of ['Pricing & Financing Guaranteed', 'Free Pricing & Financing', 'Pricing & Financing 0% APR', 'Pricing & Financing — Save 20%', 'Pricing & Financing today', 'Pricing & Financing offers', 'Pricing & Financing<script>', 'Pricing & Financing\nContact Support', 'Financing', 'Check Your Credit', 'Pricing & Financing no credit checks']) {
  test(`pricing navigation: rejects unsupported or unsafe label ${JSON.stringify(label)}`, () => {
    const action = pricing(label);
    assert.equal(actionPurpose(action, context), null);
    assert.equal(validate(action).ok, false);
  });
}

for (const destination of ['', 'javascript:alert(1)', 'https://user:secret@example.test/pricing', 'https://127.0.0.1/pricing', 'https://foreign.test/pricing', origin + '/support', origin + '/pricing?redirect=https://foreign.test']) {
  test(`pricing navigation: label cannot authorize unsafe, foreign or missing destination ${destination}`, () => {
    const action = pricing(undefined, destination);
    assert.equal(actionPurpose(action, context), null);
    assert.equal(validate(action).ok, false);
  });
}

test('pricing navigation: disabled action cannot be used or restored from discovery', () => {
  const disabled = { ...pricing(), enabled: false };
  assert.equal(validate(disabled).ok, false);
  assert.deepEqual(popupCompatibleActions([disabled], strategy, instructions, false, undefined, context), []);
  assert.deepEqual(mergeBusinessActions([disabled], [pricing()]), []);
});

test('pricing navigation: provenance, confidence and tenant binding remain mandatory', () => {
  const action = pricing();
  assert.equal(actionPurpose(action, { ...context, websiteId: 'other-tenant' }), null);
  assert.equal(actionPurpose({ ...action, authority: { ...action.authority!, confidence: .5 } }, context), null);
  assert.equal(actionPurpose({ ...action, destination: origin + '/prices' }, context), null);
  assert.equal(actionPurpose({ ...action, authority: { ...action.authority!, websiteId: 'other-tenant' } }, context), null);
  assert.equal(resolvePopupAction([action, action], 'pricing', strategy, instructions, false, 'Need help comparing pricing options?', context), null);
});

test('pricing navigation: prompt exposes only valid enabled actions and never destinations', () => {
  const identified = (action: BusinessActionConfig, actionId: string): BusinessActionConfig => ({ ...action, actionId, authority: { ...action.authority!, actionId } });
  const invalid = [
    identified(pricing('Free Pricing'), 'pricing_unsafe_label'),
    identified({ ...pricing(), enabled: false }, 'pricing_disabled'),
    identified(pricing(undefined, ''), 'pricing_missing_destination'),
    identified(pricing(undefined, 'https://foreign.test/pricing'), 'pricing_foreign'),
  ];
  const prompt = popupPromptBuilder.build({ business: { name: 'Example', objectiveKey: scenario.objective.key }, instructions, strategy, knowledge: source, websiteId, businessActions: [pricing(), ...invalid] });
  const actions = prompt.sections.find(section => section.title === 'Business Actions')!.lines.join('\n');
  assert.match(actions, /pricing: Pricing & Financing/);
  assert.match(actions, /Primary IDs: \["pricing"\]/);
  for (const action of invalid) assert.equal(actions.includes(action.actionId), false);
  assert.equal(actions.includes(origin), false);
});

test('pricing navigation: manual View Pricing configuration overrides discovery without a code change', () => {
  const manual = pricing('View Pricing', origin + '/pricing', 'owner');
  const [merged] = mergeBusinessActions([manual], [pricing()]);
  assert.equal(merged, manual);
  assert.equal(validate(merged).ok, true);
});

for (const body of ['All treatments cost $1.', 'Get a free consultation.', 'Save 20% today.', 'We guarantee perfect results.', 'Financing is available with no credit checks.']) {
  test(`pricing navigation: accepted action cannot authorize fabricated offer or claim ${body}`, () => {
    const result = validate(pricing(), body);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reasons.includes('unsupported_claim') || result.reasons.includes('business_policy'));
  });
}
