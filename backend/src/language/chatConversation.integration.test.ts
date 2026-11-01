import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { ChatStreamInput, ChatStreamEvent } from '../services/chatService.js';
import type { LLMProvider, StreamRequest } from '../llm/provider/types.js';
import type { Chunk } from '../context/types.js';
// Block real providers, databases and object storage before importing runtime.
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) process.env[key] = '';
process.env.KNOWLEDGE_STORAGE_PROVIDER = 'local'; process.env.DEBUG_TRACE = 'false';
// Reuse the existing evaluation corpus without adding CLI evaluation scripts to
// the production TypeScript compilation rooted at src/.
const fixtureModule = new URL('../../scripts/phase4-fixtures.ts', import.meta.url).href;
const { corpora }: { corpora: Array<{ id: string; origin: string; chunks: Chunk[] }> } = await import(fixtureModule);
const { getWebsiteStore } = await import('../vectorstore/registry.js');
const { streamChatReply } = await import('../services/chatService.js');
const { __setProvidersForTests } = await import('../llm/index.js');
const { logger } = await import('../logging/logger.js');
const { config } = await import('../config/index.js');
const { understandChat, conversationalReply } = await import('./chatConversation.js');
const { resolveChatLanguage } = await import('./chatLanguage.js');
const users = (...texts: string[]) => texts.map(content => ({ role: 'user' as const, content }));
const fixtures = [
  { id: 'dental', description: 'Family dental clinic', query: 'Dental cleaning price?', fact: /₹1,200/, subject: 'Dental cleaning', tone: 'calm' },
  { id: 'restaurant', description: 'Restaurant and catering', query: 'Vegetarian dinner price?', fact: /₹800.*per person/, subject: 'Vegetarian dinner', tone: 'welcoming' },
  { id: 'clothing', description: 'Online retail shop', query: 'Blue Medium Shirt price?', fact: /₹1,800.*excluding delivery fees/, subject: 'Blue Medium Shirt', tone: 'product-focused' },
  { id: 'saas', description: 'SaaS software platform', query: 'Premium Plus plan price?', fact: /₹3,499.*billed annually/, subject: 'Premium Plus plan', tone: 'solution-oriented' },
  { id: 'local', description: 'Professional plumbing services', query: 'Plumbing visit price?', fact: /£75.*excluding replacement parts/, subject: 'Plumbing visit', tone: 'consultative' },
];
async function setup(t: TestContext, fixture = fixtures[0]): Promise<ChatStreamInput> {
  const corpus = corpora.find(c => c.id === fixture.id)!;
  const websiteId = `conversation-${fixture.id}`, { store } = await getWebsiteStore(websiteId);
  store.import(corpus.chunks.map(c => {
    // Keep the existing corpus identities, amounts and conditions. Seed prices
    // using the structural card format already used by universal-chat.test.ts;
    // this task does not expand legacy sentence/qualifier price parsing.
    const price = c.content.match(/^(.+?) (costs|starts at) ([₹£$][\d,]+)(.*?)\.$/u);
    const qualification = price ? [price[2] === 'starts at' ? 'Starting price' : '', price[4].trim()].filter(Boolean).join('; ') : '';
    const content = price && (price[2] === 'costs' || price[4].trim()) ? `${price[1]} | ${price[3]} | ${qualification}` : c.content;
    return { ...c, content, embedding: [1, 0] };
  }));
  const previousKey = config.gemini.apiKey;
  (config.gemini as { apiKey: string }).apiKey = 'local-embedding-mock';
  t.after(() => { (config.gemini as { apiKey: string }).apiKey = previousKey; });
  // Controlled embeddings; every HTTP request is intercepted, never sent.
  t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => {
    assert.match(url instanceof Request ? url.url : String(url), /embedContents?/i);
    return Response.json({ embeddings: [{ values: [1, 0] }] });
  });
  t.mock.method(logger, 'debug', () => {}); t.mock.method(logger, 'info', () => {}); t.mock.method(logger, 'warn', () => {});
  __setProvidersForTests(null, null); t.after(() => __setProvidersForTests(null, null));
  return { messages: users(fixture.query), tenant: { websiteId, instructions: { businessName: fixture.id,
    websiteUrl: corpus.origin, companyDescription: fixture.description, tone: 'brief', language: 'English', alwaysBookDemo: false, avoidDiscounts: true } } };
}
const provider = (streamText: (req: StreamRequest) => AsyncIterable<string>): LLMProvider => ({ id: 'local-conversation-mock', streamText,
  async embed() { return [[1, 0]]; }, async generateStructured() { throw Error('Unexpected second generation'); } });
async function collect(input: ChatStreamInput) {
  const events: ChatStreamEvent[] = [];
  for await (const event of await streamChatReply(input)) events.push(event);
  return { text: events.filter(e => e.type === 'token').map(e => e.text).join(''), events };
}
const noRobotic = (text: string) => assert.doesNotMatch(text, /retrieved|couldn't find confirmed|according to|email address\?|guaranteed|painless|smilecraft/iu);

for (const fixture of fixtures) {
  for (const [language, query] of [
    ['English', 'I am nervous about choosing this'],
    ['Hindi', 'मुझे फैसला करने से डर लगता है'],
    ['Hinglish', 'mujhe dar lagta hai'],
  ] as const) test(`${fixture.id} ${language}: no-provider empathy and validated generation use business tone`, async t => {
    const input = await setup(t, fixture); input.messages = users(query); input.leadCaptureAvailable = true; input.allowLeadInvitation = true;
    const fallback = await collect(input); noRobotic(fallback.text);
    assert.equal(fallback.events.some(e => e.type === 'source'), false);
    assert.equal(/\p{Script=Devanagari}/u.test(fallback.text), language === 'Hindi');
    let calls = 0;
    const safe = language === 'English' ? 'I hear you. What aspect concerns you most?'
      : language === 'Hindi' ? 'आपकी चिंता समझ में आती है। किस बात की सबसे ज़्यादा चिंता है?'
      : 'Aapki chinta samajh mein aati hai. Kis baat ko lekar sabse zyada chinta hai?';
    const outcomes: Array<{ route: string; providerStatus: string }> = [];
    t.mock.method(logger, 'info', (message: string, detail?: unknown) => { if (message === '[chat] response outcome') outcomes.push(detail as typeof outcomes[number]); });
    __setProvidersForTests(provider(async function* (req) {
      calls++; assert.match(req.system, /CHAT CONVERSATION POLICY/); assert.ok(req.system.includes(fixture.tone));
      assert.ok(req.system.includes(`Reply language: ${language}`)); assert.match(req.system, /Owner preference \(priority\): brief/);
      assert.match(req.system, /Contact invitation permitted for this turn: false/); yield safe;
    }), null);
    assert.equal((await collect(input)).text, safe); assert.equal(calls, 1);
    assert.deepEqual([outcomes.at(-1)?.route, outcomes.at(-1)?.providerStatus], ['validated_provider', 'attempted']);
  });

  test(`${fixture.id}: contextual cost follow-up stays deterministic and preserves source qualifications`, async t => {
    const input = await setup(t, fixture); let calls = 0;
    __setProvidersForTests(provider(async function* () { calls++; yield 'Unexpected'; }), null);
    input.messages = users(`Do you offer ${fixture.subject}?`, 'How much?');
    const result = await collect(input); assert.match(result.text, fixture.fact); assert.equal(calls, 0);
    assert.ok(result.events.some(e => e.type === 'source' && e.source.url.startsWith(input.tenant!.instructions.websiteUrl!)));
    for (const query of ['अज्ञात सेवा की कीमत क्या है?', 'unknown service ka price kya hai?', 'unknown service price?']) {
      input.messages = users(query); const unknown = await collect(input);
      assert.doesNotMatch(unknown.text, /retrieved|couldn't find confirmed|costs|starts at/iu);
      assert.equal(unknown.events.some(e => e.type === 'source'), false);
    }
  });
  test(`${fixture.id}: hesitation, frustration, confusion and advice reach grounded conversational generation`, async t => {
    const input = await setup(t, fixture); let calls = 0;
    for (const query of ['I am not sure what suits me', 'I am frustrated with this', "I don't understand this", 'Can you help me choose?']) {
      input.messages = users(query);
      const intent = understandChat(input.messages), language = resolveChatLanguage(input.messages);
      const safe = conversationalReply(intent, language);
      __setProvidersForTests(provider(async function* (req) { calls++; assert.ok(req.system.includes(`Visitor intent: ${intent.kind}`)); yield safe; }), null);
      const result = await collect(input); assert.equal(result.text, safe); noRobotic(result.text);
    }
    assert.equal(calls, 4);
  });
}

for (const mode of ['failure', 'failover', 'unsafe', 'wrong_language'] as const) test(`concern generation ${mode}: honest routing and safe fallback`, async t => {
  const input = await setup(t); input.messages = users('mujhe dar lagta teeth treatmentse');
  const safe = 'Aapki chinta samajh mein aati hai. Kis baat ko lekar sabse zyada chinta hai?';
  let primaryCalls = 0, fallbackCalls = 0;
  const outcomes: Array<{ route: string; providerStatus: string; reasonCodes: string[] }> = [];
  t.mock.method(logger, 'info', (message: string, detail?: unknown) => { if (message === '[chat] response outcome') outcomes.push(detail as typeof outcomes[number]); });
  __setProvidersForTests(provider(async function* () {
    primaryCalls++;
    if (mode === 'failover') throw Object.assign(Error('rate limited'), { status: 429 });
    if (mode === 'failure') { yield 'We guarantee painless treatment.'; throw Error('mock partial failure'); }
    yield mode === 'wrong_language' ? 'I understand. What part worries you most?' : 'Samajh sakta hoon. Treatment bilkul painless hai.';
  }), provider(async function* () { fallbackCalls++; yield safe; }));
  const result = await collect(input); noRobotic(result.text); assert.equal(primaryCalls, 1);
  assert.equal(fallbackCalls, mode === 'failover' ? 1 : 0);
  assert.equal(outcomes.at(-1)?.route, mode === 'failover' ? 'validated_provider' : 'deterministic');
  assert.equal(outcomes.at(-1)?.providerStatus, mode === 'failure' ? 'failed' : 'attempted');
  assert.equal(result.events.some(e => e.type === 'source'), false);
});

test('Pain follows fear through the real service; later factual topic and language switches still work', async t => {
  const input = await setup(t);
  input.messages = [...users('mujhe dar lagta teeth treatmentse'), { role: 'assistant', content: 'Is it pain or the procedure?' }, ...users('Pain.')];
  let calls = 0;
  __setProvidersForTests(provider(async function* (req) {
    calls++; assert.match(req.system, /contextual follow-up: true; concern focus: pain/);
    yield conversationalReply(understandChat(input.messages), resolveChatLanguage(input.messages));
  }), null);
  const result = await collect(input); assert.match(result.text, /dard ki chinta/); assert.equal(calls, 1);
  input.messages.push(...users('Dental cleaning kitne ka hai?'));
  assert.match((await collect(input)).text, /₹1,200/); assert.equal(calls, 1);
  input.messages.push(...users('What is the dental cleaning price?'));
  const english = await collect(input); assert.match(english.text, /starts at ₹1,200/); assert.equal(calls, 1);
});

test('mixed concern retains the verified fact and rejects a fabricated price without leaking tokens', async t => {
  const input = await setup(t); input.messages = users("I'm nervous, how much does dental cleaning cost?");
  __setProvidersForTests(provider(async function* () { yield 'I understand. '; yield 'Dental cleaning costs ₹1.'; }), null);
  const result = await collect(input); assert.match(result.text, /understandable.*₹1,200/s);
  assert.doesNotMatch(result.text, /costs ₹1\./); assert.equal(result.events.filter(e => e.type === 'token').length, 1);
});

test('factual clarification retrieves the visitor topic and accepts grounded generation with history', async t => {
  const input = await setup(t, fixtures[3]);
  const first = await collect(input); assert.match(first.text, /₹3,499.*billed annually/);
  input.messages.push({ role: 'assistant', content: first.text }, ...users('What do you mean?'));
  let calls = 0;
  const decisions: Array<{ modelUsed: boolean; reasons: string[] }> = [];
  __setProvidersForTests(provider(async function* (req) {
    calls++; assert.match(req.system, /Visitor intent: clarification; contextual follow-up: true/);
    assert.ok(req.messages.some(m => m.role === 'user' && m.content === fixtures[3].query));
    yield first.text;
  }), null);
  input.onSafetyDecision = d => decisions.push(d);
  const result = await collect(input); assert.equal(result.text, first.text); assert.equal(calls, 1);
  assert.deepEqual(decisions.at(-1)?.reasons, []); assert.equal(decisions.at(-1)?.modelUsed, true);
});

test('concern cannot bypass tenant isolation or honest AI identity', async t => {
  const input = await setup(t); await setup(t, fixtures[1]);
  input.tenant!.websiteId = 'conversation-restaurant';
  input.tenant!.instructions.websiteUrl = corpora.find(c => c.id === 'restaurant')!.origin;
  input.messages = users("I'm nervous, how much does dental cleaning cost?");
  __setProvidersForTests(provider(async function* () { yield 'I understand. Dental cleaning starts at ₹1,200.'; }), null);
  const result = await collect(input); assert.doesNotMatch(result.text, /₹1,200|dental-phase4/);
  assert.equal(result.events.some(e => e.type === 'source'), false);
  input.messages = users('Are you a human?');
  assert.match((await collect(input)).text, /AI assistant/);
});
