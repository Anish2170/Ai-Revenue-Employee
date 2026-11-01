import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveChatLanguage } from './chatLanguage.js';
import { buildChatSafetyPlan, composeSafeChatReply } from './chatSafety.js';
import type { ResolvedContext } from '../context/types.js';
import { understandChat, chatBusinessStyle, conversationalReply } from './chatConversation.js';
import { validateChatDraft } from './chatSafety.js';
const users = (...texts: string[]) => texts.map(content => ({ role: 'user' as const, content }));

const snapshot = JSON.parse(readFileSync(new URL('../context/fixtures/dental-snapshot.json', import.meta.url), 'utf8'));
const context: ResolvedContext = {
  business: { name: 'Dental' }, instructions: { businessName: 'Dental', websiteUrl: snapshot.sourceUrl,
    tone: 'helpful', language: 'English', alwaysBookDemo: false, avoidDiscounts: true },
  chunks: snapshot.documents.map((d: object) => ({ ...d, score: .9 })), scores: [], businessActions: [], siteLinks: [], source: 'rag',
};
const fear = [{ role: 'user' as const, content: 'mujhe dar lagta teeth treatmentse' }];
test('observed Roman Hindi concern selects Hinglish', () => {
  assert.equal(resolveChatLanguage(fear).language, 'Hinglish');
});
test('observed concern is empathy rather than a failed business record lookup', () => {
  const plan = buildChatSafetyPlan(context, fear[0].content, resolveChatLanguage(fear));
  assert.doesNotMatch(composeSafeChatReply(plan), /couldn't find confirmed|confirmed jaankari/);
});

for (const [query, kind, language] of [
  ['mujhe dar lagta teeth treatmentse', 'fear', 'Hinglish'],
  ["I'm scared of dental treatment.", 'fear', 'English'],
  ['I am anxious about treatment', 'fear', 'English'],
  ['मुझे इलाज से डर लगता है', 'fear', 'Hindi'],
  ['I am not sure which product suits me', 'hesitation', 'English'],
  ["I'm frustrated with this service", 'frustration', 'English'],
  ["I don't understand this", 'confusion', 'English'],
  ['mujhe samajh nahi aa raha', 'confusion', 'Hinglish'],
  ['मुझे समझ नहीं आ रहा', 'confusion', 'Hindi'],
  ['Can you help me choose?', 'advice', 'English'],
  ['Can you explain that?', 'explanation', 'English'],
  ['What do you mean?', 'clarification', 'English'],
  ['I am just looking around', 'statement', 'English'],
] as const) test(`intent and language: ${query}`, () => {
  assert.equal(understandChat(users(query)).kind, kind);
  assert.equal(resolveChatLanguage(users(query)).language, language);
});

test('pain reply carries visitor concern and Hinglish preference; a new factual topic wins', () => {
  const messages = [...fear, { role: 'assistant' as const, content: 'Is it pain or the procedure?' }, ...users('Pain.')];
  const intent = understandChat(messages);
  assert.deepEqual([intent.kind, intent.contextual, intent.focus, intent.needsFacts], ['fear', true, 'pain', false]);
  const language = resolveChatLanguage(messages);
  assert.equal(language.language, 'Hinglish');
  assert.match(conversationalReply(intent, language), /dard ki chinta/);
  assert.equal(understandChat([...messages, ...users('Premium plan price?')]).kind, 'factual');
  assert.equal(understandChat(users('Pain.')).kind, 'factual');
});

for (const query of ['I want to book an appointment', 'I want a guide', 'Please contact me', 'I have a refund question']) test(`business request cannot be swallowed by first-person context: ${query}`, () => {
  assert.equal(understandChat(users(query)).needsFacts, true);
});

test('mixed concern plus a factual question retains an independent evidence obligation', () => {
  const intent = understandChat(users("I'm nervous, how much does teeth whitening cost?"));
  assert.equal(intent.kind, 'fear'); assert.equal(intent.needsFacts, true);
  assert.equal(intent.factQuery, 'how much does teeth whitening cost?');
  const plan = buildChatSafetyPlan(context, intent.factQuery, { language: 'English', explicit: false }, false, intent);
  assert.match(composeSafeChatReply(plan), /understandable.*\$399.*60-minute/s);
  assert.equal(validateChatDraft("I understand. Philips Zoom Laser Teeth Whitening costs $1.", plan).ok, false);
});

test('a price or booking concern alone does not request a factual lookup', () => {
  for (const query of ["I'm worried about the price", "I'm scared of booking", 'mujhe price ki chinta hai']) {
    assert.equal(understandChat(users(query)).needsFacts, false, query);
  }
});

test('answered concern and acknowledgements do not repeat a clarification question', () => {
  const intent = understandChat(users("I'm scared of treatment", 'The procedure'));
  assert.doesNotMatch(conversationalReply(intent, { language: 'English', explicit: false }), /\?/);
  assert.equal(conversationalReply(understandChat(users('Thanks')), { language: 'English', explicit: false }), "You're welcome.");
});

test('advice remains useful without knowledge and clarification can continue a feeling', () => {
  const intent = understandChat(users('Can you help me choose?'));
  const plan = buildChatSafetyPlan({ ...context, chunks: [] }, intent.factQuery, { language: 'English', explicit: false }, false, intent);
  const text = composeSafeChatReply(plan);
  assert.match(text, /priorities, budget/); assert.doesNotMatch(text, /details about|retrieved/);
  assert.equal(validateChatDraft(text, plan).ok, true);
  const clarification = understandChat(users("I'm scared of treatment", 'What do you mean?'));
  assert.equal(clarification.needsFacts, false);
  assert.match(conversationalReply(clarification, plan.language), /I meant/);
});

for (const query of ['Will it hurt?', 'I am worried, is this treatment safe?', 'I am nervous, do you guarantee results?']) test(`fear never authorizes an unsupported medical promise: ${query}`, () => {
  const intent = understandChat(users(query));
  assert.equal(intent.needsFacts, true);
  const plan = buildChatSafetyPlan(context, intent.factQuery, { language: 'English', explicit: false }, false, intent);
  assert.equal(validateChatDraft('I understand. Our treatment is painless and completely safe.', plan).ok, false);
});

test('natural provider empathy can pass without facts; arbitrary reassuring claims cannot', () => {
  const plan = buildChatSafetyPlan(context, "I'm scared", { language: 'English', explicit: false });
  assert.equal(validateChatDraft('I hear you. What aspect concerns you most?', plan).ok, true);
  for (const draft of ["I understand, our treatment is painless.", 'I understand. We have appointments tomorrow.', 'I understand. Email us at steal@evil.example.', 'I am a real human.', 'I understand. [1]', 'I understand. Take a painkiller.']) {
    assert.equal(validateChatDraft(draft, plan).ok, false, draft);
  }
});

test('wrong provider language fails closed while Hindi and Hinglish empathy pass', () => {
  for (const language of ['Hindi', 'Hinglish'] as const) {
    const plan = buildChatSafetyPlan(context, fear[0].content, { language, explicit: true });
    assert.equal(validateChatDraft(conversationalReply(plan.conversation!, plan.language), plan).ok, true);
    assert.equal(validateChatDraft('I understand. What part worries you most?', plan).ok, false);
  }
});

test('business-aware style uses context with owner priority and a neutral default; no facts inferred', () => {
  for (const [description, expected] of [['Family dental clinic', 'calm'], ['Restaurant and catering', 'welcoming'], ['Online retail shop', 'product-focused'], ['SaaS software platform', 'solution-oriented'], ['Professional design services', 'consultative']]) {
    const ctx = { ...context, chunks: [], instructions: { ...context.instructions, companyDescription: description, tone: 'formal and brief' } };
    assert.match(chatBusinessStyle(ctx).tone, /Owner preference \(priority\): formal and brief/);
    assert.ok(chatBusinessStyle(ctx).tone.includes(expected));
    assert.equal(buildChatSafetyPlan(ctx, 'Do you offer free consultations?', { language: 'English', explicit: false }).state, 'unknown');
  }
  const empty = { ...context, chunks: [], business: { name: 'Unknown' }, instructions: { ...context.instructions, tone: '' } };
  assert.deepEqual(chatBusinessStyle(empty), { tone: 'neutral, helpful', basis: 'neutral_default' });
  assert.equal(chatBusinessStyle({ ...empty, chunks: [{ ...context.chunks[0], url: 'https://foreign.example/', content: 'Restaurant menu', heading: 'Catering' }] }).basis, 'neutral_default');
  const saas = { ...context, instructions: { ...context.instructions, companyDescription: 'SaaS software platform' },
    chunks: [{ ...context.chunks[0], heading: 'Retail customer example', content: 'A shop uses this product.' }] };
  assert.match(chatBusinessStyle(saas).tone, /solution-oriented/);
});
