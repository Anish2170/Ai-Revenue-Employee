import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
process.env.DATABASE_URL = ''; process.env.DEBUG_TRACE = 'false';
const { config } = await import('../config/index.js');
const { getWebsiteStore } = await import('../vectorstore/registry.js');
const { streamChatReply } = await import('../services/chatService.js');
const { __setProvidersForTests } = await import('../llm/index.js');
const { ownerAction } = await import('../intelligence/__tests__/phase26Fixtures.js');
import type { StreamRequest } from '../llm/provider/types.js';
type Input = Parameters<typeof streamChatReply>[0];
const instructions = { businessName: 'NovaCare Clinic', language: 'English', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: true, websiteUrl: 'https://example.test' };
const fact = 'Dental cleaning starts at ₹1,200.';
async function setup(t: TestContext, generate: (req: StreamRequest) => AsyncIterable<string>, texts = [fact]) {
  const websiteId = 'chat-safety-integration'; const { store } = await getWebsiteStore(websiteId);
  store.import(texts.map((content, i) => ({ id: `fact-${i}`, content, title: 'Clinic facts', heading: 'Clinic facts', page: '/facts', url: 'https://example.test/facts', pageType: 'faq', section: '', language: 'English', hash: '', lastCrawled: '', embedding: [1, 0] })));
  const key = config.gemini.apiKey; (config.gemini as { apiKey: string }).apiKey = 'synthetic';
  t.after(() => { (config.gemini as { apiKey: string }).apiKey = key; __setProvidersForTests(null, null); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ embeddings: [{ values: [1, 0] }] }));
  __setProvidersForTests({ id: 'synthetic-adversarial-draft', streamText: generate, async generateStructured() { throw Error('unexpected'); }, async embed() { throw Error('unexpected'); } }, null);
  return { messages: [{ role: 'user', content: 'Explain dental cleaning price?' }], tenant: { websiteId, instructions } } as Input;
}
async function collect(input: Input) { const events = []; for await (const event of await streamChatReply(input)) events.push(event); return { events, text: events.filter(e => e.type === 'token').map(e => e.text).join('') }; }

test('actual retrieval and safe model draft produce supported answer and server-owned source', async t => {
  let calls = 0;
  const input = await setup(t, async function* (req) { calls++; assert.match(req.system, /CHAT EVIDENCE CONTRACT/); yield fact; });
  const result = await collect(input); assert.equal(result.text, fact); assert.equal(calls, 1);
  assert.deepEqual(result.events.find(e => e.type === 'source'), { type: 'source', source: { title: 'Clinic facts', url: 'https://example.test/facts' } });
});
test('unsafe partial draft is buffered and never exposed before completion', async t => {
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>(resolve => release = resolve), entered = new Promise<void>(resolve => started = resolve);
  const input = await setup(t, async function* () { yield 'We offer free implants.'; started(); await wait; yield ' ' + fact; });
  const stream = (await streamChatReply(input))[Symbol.asyncIterator](); let exposed = false;
  const first = stream.next().then(value => { exposed = true; return value; });
  await entered; await Promise.resolve(); assert.equal(exposed, false); release();
  assert.equal((await first).value?.type, 'token'); await stream.return?.();
});
test('provider failure after partial tokens discards unsafe text and composes verified facts', async t => {
  const input = await setup(t, async function* () { yield 'Your appointment is confirmed.'; throw Error('synthetic stream failed'); });
  assert.equal((await collect(input)).text, fact);
});
test('empty known-answer stream composes the supported answer', async t => {
  assert.equal((await collect(await setup(t, async function* () {}))).text, fact);
});
test('missing evidence and contradictory evidence short-circuit model generation', async t => {
  let calls = 0;
  const input = await setup(t, async function* () { calls++; yield 'Wrong'; }, [fact, 'Dental cleaning starts at ₹999.']);
  assert.match((await collect(input)).text, /conflict/);
  input.messages = [{ role: 'user', content: 'Do you offer dental implants?' }];
  assert.match((await collect(input)).text, /confirmed information about dental implant/); assert.equal(calls, 0);
});
test('client cancellation prevents late ignored-abort tokens and follow-on fallback', async t => {
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => started = resolve), wait = new Promise<void>(resolve => release = resolve);
  const input = await setup(t, async function* () { started(); await wait; yield 'Your appointment is confirmed.'; });
  const controller = new AbortController(); input.signal = controller.signal;
  const pending = collect(input); await entered; controller.abort(new Error('client left'));
  await assert.rejects(pending, /client left/); release(); await Promise.resolve();
});
test('booking configuration is re-read after generation; stale authority cannot produce link', async t => {
  const input = await setup(t, async function* () { yield 'Online booking is available.'; }, ['Online booking is available.']);
  input.messages = [{ role: 'user', content: 'Where can I book online?' }];
  input.tenant!.businessActions = [ownerAction('book_appointment', 'Book Your Smile Consultation', '/appointments')];
  input.refreshActions = async () => [];
  const result = await collect(input); assert.ok(!result.text.includes('https://example.test/appointments')); assert.match(result.text, /verified booking link/);
});
test('qualified contact offer is voluntary and is not repeated or treated as resource delivery', async t => {
  const input = await setup(t, async function* () { yield fact; });
  input.leadCaptureAvailable = true; input.allowLeadInvitation = true;
  const first = await collect(input); assert.match(first.text, /email address/); assert.ok(!first.text.includes('send it'));
  input.messages = [...input.messages, { role: 'assistant', content: first.text }, { role: 'user', content: 'Dental cleaning price?' }];
  assert.equal((await collect(input)).text, fact);
});
test('a low-intent known answer does not turn persistence availability into a forced sales ask', async t => {
  const input = await setup(t, async function* () { yield fact; }); input.leadCaptureAvailable = true;
  assert.equal((await collect(input)).text, fact);
});
test('an exact English model fact cannot bypass an explicit French source-wrapper preference', async t => {
  const input = await setup(t, async function* () { yield fact; });
  input.messages = [{ role: 'user', content: 'Please reply in French from now on.' }, { role: 'user', content: 'Dental cleaning price?' }];
  const result = await collect(input); assert.match(result.text, /Extrait exact/); assert.ok(result.text.includes(fact));
});
test('unknown answer source follow-up cannot cite a related source as proof', async t => {
  const input = await setup(t, async function* () { throw Error('Unknown must not generate'); });
  input.messages = [{ role: 'user', content: 'Do you offer dental implants?' }, { role: 'assistant', content: 'Information is unconfirmed.' }, { role: 'user', content: 'What is your source?' }];
  const result = await collect(input); assert.match(result.text, /confirmed information about dental implant/); assert.equal(result.events.some(e => e.type === 'source'), false);
});
test('oversized draft is cancelled and replaced before output', async t => {
  let signal: AbortSignal | undefined;
  const input = await setup(t, async function* (req) { signal = req.signal; yield 'x'.repeat(8001); });
  assert.equal((await collect(input)).text, fact); assert.equal(signal?.aborted, true);
});
test('production safety diagnostics correlate reasons without retaining private drafts or questions', async t => {
  const { logger } = await import('../logging/logger.js');
  const entries: unknown[] = [];
  t.mock.method(logger, 'info', (message: string, detail?: unknown) => { if (message === '[chat] evidence decision') entries.push(detail); });
  const input = await setup(t, async function* () { yield 'Private unsupported draft: free implants today.'; });
  input.debug = { requestId: 'http-test-correlation' };
  await collect(input);
  assert.deepEqual(entries, [{ requestId: 'http-test-correlation', websiteId: input.tenant!.websiteId,
    state: 'known_positive', reasons: ['unverified_claim_or_capability', 'missing_supported_answer'], modelUsed: true }]);
  assert.ok(!JSON.stringify(entries).includes('Private unsupported draft'));
  assert.ok(!JSON.stringify(entries).includes('Dental cleaning price?'));
});
