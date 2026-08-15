import assert from 'node:assert/strict';
import test from 'node:test';
import { __setProvidersForTests, generateDecision, streamChat } from '../index.js';
import type { LLMProvider } from '../provider/types.js';

const request = { system: 'grounded system', messages: [{ role: 'user' as const, content: 'RAG supplied content' }] };
const structured = { system: 'grounded system', user: 'RAG supplied content', schema: { type: 'object' } };
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
