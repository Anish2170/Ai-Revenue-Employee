import assert from 'node:assert/strict';
import test from 'node:test';
import { __setProvidersForTests, generateDecision, streamChat } from '../index.js';
import type { LLMProvider } from '../provider/types.js';
import { createOpenAIProvider } from '../provider/openai.js';
import { config } from '../../config/index.js';
import { popupJsonSchema } from '../../validation/popupSchema.js';

const request = { system: 'grounded system', messages: [{ role: 'user' as const, content: 'RAG supplied content' }] };
const structured = { system: 'grounded system', user: 'RAG supplied content', schema: popupJsonSchema };
function provider(id: string, stream: () => AsyncIterable<string>, result: () => Promise<unknown> = async () => ({ ok: id })): LLMProvider {
  return { id, streamText: stream, generateStructured: result, embed: async () => [] };
}
async function collect(source: AsyncIterable<string>): Promise<string> { let output = ''; for await (const item of source) output += item; return output; }
function transient(status: number): Error & { status: number } { const error = new Error(`provider ${status}`) as Error & { status: number }; error.status = status; return error; }

test('primary model succeeds without fallback', async () => {
  let fallbackCalls = 0;
  __setProvidersForTests(provider('primary', async function* () { yield 'primary'; }), provider('gemini', async function* () { fallbackCalls++; yield 'fallback'; }));
  assert.equal(await collect(streamChat(request)), 'primary');
  assert.equal(fallbackCalls, 0);
});

for (const [name, status] of [['timeout', 504], ['5xx', 503], ['rate-limit', 429]] as const) {
  test(`primary ${name} before stream uses Gemini fallback`, async () => {
    let primaryCalls = 0;
    __setProvidersForTests(provider('primary', async function* () { primaryCalls++; throw transient(status); }), provider('gemini', async function* () { yield 'gemini'; }));
    assert.equal(await collect(streamChat(request)), 'gemini');
    assert.ok(primaryCalls <= 2, 'primary retry count is bounded');
  });
}

test('primary failure after a token never starts duplicate fallback', async () => {
  let fallbackCalls = 0;
  __setProvidersForTests(provider('primary', async function* () { yield 'partial'; throw transient(503); }), provider('gemini', async function* () { fallbackCalls++; yield 'duplicate'; }));
  await assert.rejects(() => collect(streamChat(request)));
  assert.equal(fallbackCalls, 0);
});

test('fallback failure surfaces an error for the route safe response', async () => {
  __setProvidersForTests(provider('primary', async function* () { throw transient(503); }), provider('gemini', async function* () { throw transient(503); }));
  await assert.rejects(() => collect(streamChat(request)));
});

test('input errors do not call fallback', async () => {
  let fallbackCalls = 0;
  __setProvidersForTests(provider('primary', async function* () { throw transient(400); }), provider('gemini', async function* () { fallbackCalls++; yield 'no'; }));
  await assert.rejects(() => collect(streamChat(request)));
  assert.equal(fallbackCalls, 0);
});

test('structured generation uses the primary provider and keeps the request unchanged', async () => {
  let seen: unknown;
  __setProvidersForTests(provider('primary', async function* () {}, async () => { seen = structured; return { ok: true }; }), provider('gemini', async function* () {}));
  assert.deepEqual(await generateDecision(structured), { ok: true });
  assert.equal((seen as typeof structured).user, 'RAG supplied content');
});

for (const status of [400, 401, 403, 422]) {
  test(`structured popup HTTP ${status} surfaces without retries or provider fallback`, async (t) => {
    t.after(() => __setProvidersForTests(null, null));
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status }));
    let fallbackCalls = 0;
    __setProvidersForTests(createOpenAIProvider(), provider('gemini', async function* () {}, async () => { fallbackCalls++; return {}; }));
    await assert.rejects(() => generateDecision(structured), (error: unknown) => {
      assert.equal((error as Error & { status: number }).status, status);
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(fallbackCalls, 0);
  });
}

for (const status of [429, 503]) {
  test(`structured popup HTTP ${status} uses bounded retries and forwards production schema to fallback`, async (t) => {
    t.after(() => __setProvidersForTests(null, null));
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status }));
    const popup = { title: 'Help', body: 'Need help?', primaryAction: '', secondaryAction: '', tone: 'helpful', popupType: 'educational' };
    let fallbackCalls = 0;
    // Assert the facade forwards the same prompt/schema rather than rebuilding it.
    const fallback: LLMProvider = {
      ...provider('gemini', async function* () {}),
      async generateStructured(req) { fallbackCalls++; assert.equal(req, structured); return popup; },
    };
    __setProvidersForTests(createOpenAIProvider(), fallback);
    assert.deepEqual(await generateDecision(structured), popup);
    assert.equal(fetchMock.mock.callCount(), status === 429 ? 1 : config.llm.primaryRetries + 1);
    assert.equal(fallbackCalls, 1);
  });
}

test('structured popup fallback failure propagates to the caller', async (t) => {
  t.after(() => __setProvidersForTests(null, null));
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }));
  const failure = new Error('Gemini structured generation failed');
  __setProvidersForTests(createOpenAIProvider(), provider('gemini', async function* () {}, async () => { throw failure; }));
  await assert.rejects(() => generateDecision(structured), error => error === failure);
});
