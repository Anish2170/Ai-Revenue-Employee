import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { ChatStreamInput, ChatStreamEvent } from './chatService.js';
import type { StructuredRequest, StreamRequest } from '../llm/provider/types.js';
for (const key of ['DATABASE_URL', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) process.env[key] = '';
const { config } = await import('../config/index.js');
const { streamChatReply } = await import('./chatService.js');
const { getWebsiteStore } = await import('../vectorstore/registry.js');
const { __setProvidersForTests } = await import('../llm/index.js');
const { clearChatAnswerCache } = await import('./chatAnswerCache.js');
const { logger } = await import('../logging/logger.js');

async function setup(t: TestContext, site = 'natural-fixture', content = 'Basic plan\n$20/month\nBilled annually; excluding tax.') {
 Object.assign(config.chat, { responseMode: 'hybrid' }); clearChatAnswerCache();
 const oldKey = config.gemini.apiKey; Object.assign(config.gemini, { apiKey: 'mock-only' });
 t.after(() => { Object.assign(config.gemini, { apiKey: oldKey }); clearChatAnswerCache(); __setProvidersForTests(null, null); });
 const { store } = await getWebsiteStore(site);
 store.import(content ? [{ id: 'basic-source', url: 'https://natural.example/pricing', page: '/pricing', pageType: 'pricing', title: 'Plans', heading: 'Basic plan', section: '', language: 'English', hash: '', lastCrawled: '', content, embedding: [1, 0] }] : []);
 let embeddings = 0;
 t.mock.method(globalThis, 'fetch', async (url: string | URL | Request) => { assert.match(url instanceof Request ? url.url : String(url), /embedcontents?/i); embeddings++; return Response.json({ embeddings: [{ values: [1, 0] }] }); });
 const logs: Array<{ message: string; detail: any }> = [];
 t.mock.method(logger, 'info', (message: string, detail?: unknown) => { logs.push({ message, detail }); });
 const input: ChatStreamInput = { messages: [{ role: 'user', content: 'Basic plan price?' }], tenant: { websiteId: site,
  instructions: { businessName: 'Natural', websiteUrl: 'https://natural.example', language: 'English', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: false }, businessActions: [] } };
 return { input, store, logs, embeddings: () => embeddings };
}
async function collect(input: ChatStreamInput) {
 const events: ChatStreamEvent[] = [];
 for await (const event of await streamChatReply(input)) events.push(event);
 return { events, text: events.filter(e => e.type === 'token').map(e => e.text).join('') };
}
function mockProvider(answer: string | ((req: StreamRequest) => string), review?: (req: StructuredRequest) => unknown) {
 const calls = { answers: 0, reviews: 0 };
 __setProvidersForTests({ id: 'mock-natural', async *streamText(req) { calls.answers++; req.onUsage?.({ provider: 'mock', model: 'fixture', inputTokens: 100, outputTokens: 20, cachedInputTokens: 10 }); yield typeof answer === 'function' ? answer(req) : answer; },
  async generateStructured(req) { calls.reviews++; return review ? review(req) : { supported: true, complete: true, answerability: 'supported', sourceIds: ['basic-source'], reason: 'supported' }; }, async embed() { throw Error('unexpected'); } }, null);
 return calls;
}
test('new factual answer uses generation; qualified paraphrase passes semantic review and repeat avoids BOTH APIs', async t => {
 const s = await setup(t), answer = 'The Basic plan is $20/month, billed annually and excluding tax.';
 const calls = mockProvider(req => { assert.match(req.system, /Billed annually/); assert.equal(req.maxOutputTokens, 700); return answer; });
 assert.equal((await collect(s.input)).text, answer);
 assert.deepEqual(calls, { answers: 1, reviews: 1 }); assert.equal(s.embeddings(), 1);
 s.input.messages.push({ role: 'assistant', content: answer }, { role: 'user', content: 'Basic plan price?' });
 assert.equal((await collect(s.input)).text, answer);
 assert.deepEqual(calls, { answers: 1, reviews: 1 }); assert.equal(s.embeddings(), 1);
 assert.equal((await collect(s.input)).text, answer);
 assert.deepEqual(calls, { answers: 1, reviews: 1 }); assert.equal(s.embeddings(), 1);
 assert.ok(s.logs.some(l => l.detail?.route === 'answer_cache'));
 assert.ok(s.logs.some(l => l.message === '[chat] token usage' && l.detail.inputTokens === 100));
 assert.ok(s.logs.filter(l => l.message === '[chat] token usage').every(l => !JSON.stringify(l).includes('Basic')));
});
for (const query of ['Hi', 'thanks', 'namaste', 'धन्यवाद']) test(`greeting is local without embeddings or generation: ${query}`, async t => {
 const s = await setup(t); s.input.messages[0].content = query;
 const calls = mockProvider('unexpected'); assert.ok((await collect(s.input)).text);
 assert.deepEqual(calls, { answers: 0, reviews: 0 }); assert.equal(s.embeddings(), 0);
});
test('an unknown business question still reaches AI; honest unknown is allowed but never cached', async t => {
 const s = await setup(t, 'natural-empty', ''); s.input.messages[0].content = 'How much is childcare?';
 const calls = mockProvider('I don’t have a confirmed childcare fee here. Which location are you interested in?', () => ({ supported: true, complete: true, answerability: 'unknown', sourceIds: [], reason: 'supported' }));
 for (let i = 0; i < 2; i++) assert.match((await collect(s.input)).text, /Which location/);
 assert.deepEqual(calls, { answers: 2, reviews: 2 });
});
for (const [name, patch] of [
 ['language', (s: Awaited<ReturnType<typeof setup>>) => { s.input.messages[0].content = 'Basic plan ki price kya hai?'; }],
 ['settings', (s: Awaited<ReturnType<typeof setup>>) => { s.input.tenant!.instructions.tone = 'warm'; }],
 ['knowledge', (s: Awaited<ReturnType<typeof setup>>) => { s.store.import(s.store.export().map(d => ({ ...d, content: d.content + '\nNew qualification: annual contract required.' }))); }],
 ['actions', (s: Awaited<ReturnType<typeof setup>>) => { s.input.tenant!.businessActions = [{ actionId: 'contact', label: 'Contact', destinationType: 'URL', destination: 'https://natural.example/contact', enabled: true }]; }],
] as const) test(`cached answer invalidates when ${name} changes`, async t => {
 const s = await setup(t), calls = mockProvider('Basic plan costs $20/month. Billed annually; excluding tax.');
 await collect(s.input); patch(s); await collect(s.input); assert.equal(calls.answers, 2);
});
test('contextual follow-ups and personal questions bypass the public FAQ cache', async t => {
 const s = await setup(t), calls = mockProvider('Basic plan costs $20/month. Billed annually; excluding tax.');
 await collect(s.input);
 s.input.messages = [{ role: 'user', content: 'I am a student.' }, { role: 'assistant', content: 'What would you like to know?' }, { role: 'user', content: 'Basic plan price?' }];
 await collect(s.input); await collect(s.input); assert.equal(calls.answers, 3);
});
test('tenant identity cannot reuse another website answer', async t => {
 const s = await setup(t), calls = mockProvider('Basic plan costs $20/month. Billed annually; excluding tax.');
 await collect(s.input); const { store } = await getWebsiteStore('other-natural-tenant'); store.import(s.store.export());
 s.input.tenant!.websiteId = 'other-natural-tenant'; await collect(s.input); assert.equal(calls.answers, 2);
});
test('expired FAQ entries regenerate', async t => {
 const s = await setup(t), previous = config.chat.cacheTtlMs; Object.assign(config.chat, { cacheTtlMs: -1 }); t.after(() => { Object.assign(config.chat, { cacheTtlMs: previous }); });
 const calls = mockProvider('Basic plan costs $20/month. Billed annually; excluding tax.');
 await collect(s.input); await collect(s.input); assert.equal(calls.answers, 2);
});
for (const text of ['The Basic plan is $1/month.', 'Your booking is confirmed.', 'Book at https://evil.example/', 'Please share your email address.']) test(`unsafe draft never escapes: ${text}`, async t => {
 const s = await setup(t), calls = mockProvider(text);
 const result = await collect(s.input); assert.notEqual(result.text, text); assert.match(result.text, /\$20/);
 assert.equal(calls.reviews, 0); assert.equal(result.events.filter(e => e.type === 'token').length, 1);
});
for (const review of [
 { supported: false, complete: true, answerability: 'supported', sourceIds: ['basic-source'], reason: 'missing_qualification' },
 { supported: true, complete: true, answerability: 'supported', sourceIds: ['foreign-source'], reason: 'supported' },
 { supported: true, complete: true, answerability: 'supported', sourceIds: [], reason: 'supported' },
 { supported: true },
]) test(`missing conditions or malformed evidence review fails closed: ${JSON.stringify(review)}`, async t => {
 const s = await setup(t); mockProvider('Basic is $20/month.', () => review);
 assert.match((await collect(s.input)).text, /Billed annually.*excluding tax/);
});
test('provider failure falls back safely and is never cached', async t => {
 const s = await setup(t); let calls = 0;
 __setProvidersForTests({ id: 'failing', async *streamText() { calls++; yield 'Your booking'; throw Error('provider failed'); }, async generateStructured() { throw Error('unexpected'); }, async embed() { return []; } }, null);
 for (let i = 0; i < 2; i++) assert.match((await collect(s.input)).text, /\$20/);
 assert.equal(calls, 2);
});
test('partial evidence can produce a useful AI answer without pretending missing information exists', async t => {
 const s = await setup(t); s.input.messages[0].content = 'What is the Basic price and its refund policy?';
 const reply = 'Basic is $20/month, billed annually and excluding tax. I cannot confirm its refund policy here.';
 mockProvider(reply, () => ({ supported: true, complete: true, answerability: 'partial', sourceIds: ['basic-source'], reason: 'supported' }));
 assert.equal((await collect(s.input)).text, reply);
});
test('equivalent decimal price formatting passes meaning-based validation', async t => {
 const s = await setup(t), reply = 'Basic is $20.00/month, billed annually and excluding tax.';
 const calls = mockProvider(reply);
 assert.equal((await collect(s.input)).text, reply); assert.equal(calls.reviews, 1);
});
test('an exact supported price cannot bypass completeness review for a multipart question', async t => {
 const s = await setup(t); s.input.messages[0].content = 'Basic plan price and features?';
 const calls = mockProvider('Basic plan costs $20/month. Billed annually; excluding tax.', () => ({ supported: true, complete: false, answerability: 'partial', sourceIds: ['basic-source'], reason: 'missing_answer' }));
 await collect(s.input); assert.equal(calls.reviews, 1);
 assert.ok(s.logs.some(l => l.detail?.route === 'safe_fallback'));
});
test('action removed during generation cannot authorize a stale booking URL', async t => {
 const s = await setup(t); s.input.messages[0].content = 'How do I book a demo?';
 const destination = 'https://natural.example/demo'; s.input.tenant!.businessActions = [{ actionId: 'book_demo', label: 'Book Demo', destination, destinationType: 'URL', enabled: true,
  authority: { source: 'discovered', websiteId: s.input.tenant!.websiteId, actionId: 'book_demo', label: 'Book Demo', destination, destinationType: 'URL', confidence: .99 } }];
 let reads = 0; const originalActions = s.input.tenant!.businessActions;
 s.input.refreshActions = async () => ++reads === 1 ? originalActions! : [];
 mockProvider(`You can request a demo at ${destination}`);
 assert.doesNotMatch((await collect(s.input)).text, /natural.example\/demo/);
});

test('cache lookup refreshes action configuration before reusing an answer', async t => {
 const s = await setup(t), destination = 'https://natural.example/contact';
 let active = true;
 const action = { actionId: 'contact', label: 'Contact', destinationType: 'URL' as const, destination, enabled: true,
  authority: { source: 'discovered' as const, websiteId: s.input.tenant!.websiteId, actionId: 'contact', label: 'Contact', destinationType: 'URL' as const, destination, confidence: .99 } };
 s.input.refreshActions = async () => active ? [action] : [];
 const calls = mockProvider('Basic is $20/month, billed annually and excluding tax.');
 await collect(s.input); active = false; await collect(s.input);
 assert.equal(calls.answers, 2);
});
test('cancellation prevents partial tokens and prevents cache population', async t => {
 const s = await setup(t), controller = new AbortController(); s.input.signal = controller.signal;
 __setProvidersForTests({ id: 'cancel', async *streamText() { yield 'Some draft'; controller.abort(Error('cancelled')); yield 'more'; }, async generateStructured() { throw Error('unexpected'); }, async embed() { return []; } }, null);
 await assert.rejects(collect(s.input), /cancelled/);
});

for (const [industry, query, source, reply] of [
 ['dental', 'Dental cleaning price?', 'Dental cleaning\n₹1,200\nStarting price; per visit.', 'Dental cleaning starts at ₹1,200 per visit.'],
 ['restaurant', 'Vegetarian dinner price?', 'Vegetarian dinner\n₹800\nPer person; excluding drinks.', 'Vegetarian dinner is ₹800 per person, excluding drinks.'],
 ['ecommerce', 'Blue shirt price?', 'Blue shirt\n₹1,800\nPer item; excluding delivery fees.', 'The blue shirt is ₹1,800 per item, with delivery fees separate.'],
 ['saas', 'Premium price?', 'Premium\n$20/month\nBilled annually; excluding tax.', 'Premium is $20/month, billed annually and excluding tax.'],
 ['hotel', 'Standard room price?', 'Standard room\n$90/night\nExcluding local taxes.', 'A standard room is $90 per night, excluding local taxes.'],
 ['gym', 'free trail', 'Free Trial\nExperience our facilities and classes for 3 consecutive days with no commitments.', 'You can try the facilities and classes free for 3 consecutive days, with no commitments.'],
] as const) test(`shared natural-answer flow preserves ${industry} facts and qualifications`, async t => {
 const s = await setup(t, 'natural-' + industry, source); s.input.messages[0].content = query;
 const calls = mockProvider(reply);
 assert.equal((await collect(s.input)).text, reply); assert.equal(calls.answers, 1);
});

test('Hinglish paraphrase keeps Roman script and the source amount/conditions', async t => {
 const s = await setup(t); s.input.messages[0].content = 'Basic plan ki price kya hai?';
 const reply = 'Basic plan $20/month ka hai, annual billing hoti hai aur tax alag hai.';
 mockProvider(req => { assert.match(req.system, /"language":"Hinglish"/); return reply; });
 assert.equal((await collect(s.input)).text, reply);
});

test('follow-up conversation is sent to generation and cannot reuse the preceding public FAQ answer', async t => {
 const s = await setup(t), calls = mockProvider('Basic plan costs $20/month. Billed annually; excluding tax.');
 await collect(s.input);
 s.input.messages.push({ role: 'assistant', content: 'Basic plan costs $20/month.' }, { role: 'user', content: 'Does that include tax?' });
 mockProvider(req => { assert.ok(req.messages.some(m => m.content === 'Basic plan price?')); return 'Tax is excluded from that price.'; });
 assert.equal((await collect(s.input)).text, 'Tax is excluded from that price.');
 assert.equal(calls.answers, 1);
});
