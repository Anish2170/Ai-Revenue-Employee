import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAIProvider } from '../provider/openai.js';
import { createGeminiProvider } from '../provider/gemini.js';
import { __setProvidersForTests, generateDecision } from '../index.js';
import { config } from '../../config/index.js';
import { popupJsonSchema } from '../../validation/popupSchema.js';
import { generateSafePopup } from '../../intelligence/popupPipeline.js';
import { perceive } from '../../intelligence/perceive.js';
import { SCENARIOS } from '../../intelligence/__tests__/fixtures.js';
import type { LLMProvider, StructuredRequest } from '../provider/types.js';

const request = { system: 'Only supplied facts.', user: 'Facts.', schema: popupJsonSchema };
const provider = (fn: (req: StructuredRequest) => Promise<unknown>): LLMProvider => ({ id: 'controlled', generateStructured: fn, streamText: async function* () {}, embed: async () => [] });

test('F14: OpenAI signal reaches real HTTP fetch and aborts a hanging request', async t => {
  const controller = new AbortController(); let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (...[, init]: Parameters<typeof fetch>) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  });
  const pending = createOpenAIProvider().generateStructured({ ...request, signal: controller.signal });
  controller.abort(new Error('navigation changed'));
  await assert.rejects(pending, /navigation changed/); assert.equal(signal?.aborted, true);
});
test('F14: OpenAI cancellation covers hanging response body after HTTP headers', async t => {
  const controller = new AbortController(); let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (...[, init]: Parameters<typeof fetch>) => {
    signal = init?.signal ?? undefined;
    return { ok: true, json: () => new Promise(() => {}) } as Response;
  });
  const pending = createOpenAIProvider().generateStructured({ ...request, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 0)); controller.abort(new Error('chat opened'));
  await assert.rejects(pending, /chat opened/); assert.equal(signal?.aborted, true);
});
test('F14: provider ignoring cancellation cannot return a late successful popup', async t => {
  const controller = new AbortController(); let complete!: (value: unknown) => void; let fallback = 0;
  __setProvidersForTests(provider(() => new Promise(resolve => { complete = resolve; })), provider(async () => { fallback++; return {}; }));
  t.after(() => __setProvidersForTests(null, null));
  const pending = generateDecision({ ...request, signal: controller.signal, deadlineAt: Date.now() + 500 });
  controller.abort(new Error('session renewed')); complete({ title: 'Late' });
  await assert.rejects(pending, /session renewed/); assert.equal(fallback, 0);
});
test('F14: bounded primary deadline leaves fallback time and aborts primary fetch before fallback starts', async t => {
  let primarySignal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (...[, init]: Parameters<typeof fetch>) => {
    primarySignal = init?.signal ?? undefined;
    return new Promise<Response>((_, reject) => primarySignal!.addEventListener('abort', () => reject(primarySignal!.reason), { once: true }));
  });
  let fallbackCalls = 0;
  __setProvidersForTests(createOpenAIProvider(), provider(async req => { fallbackCalls++; assert.equal(primarySignal?.aborted, true); assert.equal(req.schema, popupJsonSchema); return { ok: true }; }));
  t.after(() => __setProvidersForTests(null, null));
  assert.deepEqual(await generateDecision({ ...request, deadlineAt: Date.now() + 80 }), { ok: true });
  assert.equal(fallbackCalls, 1);
});
test('F14: external abort during retry delay never starts another provider or fallback', async t => {
  let calls = 0, fallback = 0; const controller = new AbortController();
  __setProvidersForTests(provider(async () => { calls++; throw Object.assign(new Error('network failure'), { status: 503 }); }), provider(async () => { fallback++; return {}; }));
  t.after(() => __setProvidersForTests(null, null));
  const pending = generateDecision({ ...request, signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort(new Error('hidden'));
  await assert.rejects(pending, /hidden/); assert.equal(calls, 1); assert.equal(fallback, 0);
});
test('F14: already-cancelled requests do not invoke any provider', async t => {
  let calls = 0; const controller = new AbortController(); controller.abort(new Error('obsolete'));
  __setProvidersForTests(provider(async () => { calls++; return {}; }), provider(async () => { calls++; return {}; }));
  t.after(() => __setProvidersForTests(null, null));
  await assert.rejects(generateDecision({ ...request, signal: controller.signal }), /obsolete/); assert.equal(calls, 0);
});
test('F14: expired application deadline prevents all provider work; hanging fallback also shares the deadline', async t => {
  let calls = 0;
  __setProvidersForTests(provider(async () => { calls++; throw Object.assign(new Error('overloaded'), { status: 429 }); }), provider(() => { calls++; return new Promise(() => {}); }));
  t.after(() => __setProvidersForTests(null, null));
  await assert.rejects(generateDecision({ ...request, deadlineAt: Date.now() - 1 }), /timed out/); assert.equal(calls, 0);
  await assert.rejects(generateDecision({ ...request, deadlineAt: Date.now() + 10 }), /timed out/); assert.equal(calls, 2);
});
test('F14: installed Gemini SDK receives its supported HTTP timeout and aborts network at that deadline', async t => {
  const original = config.gemini.apiKey; (config.gemini as { apiKey: string }).apiKey = 'synthetic-test';
  t.after(() => { (config.gemini as { apiKey: string }).apiKey = original; });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, 'fetch', async (...[, init]: Parameters<typeof fetch>) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_, reject) => signal!.addEventListener('abort', () => reject(new Error('SDK aborted')), { once: true }));
  });
  await assert.rejects(createGeminiProvider().generateStructured({ ...request, deadlineAt: Date.now() + 15 }));
  assert.equal(signal?.aborted, true);
});
test('F14: cancellation during retrieval prevents later LLM generation even if retrieval ignores it', async () => {
  const scenario = SCENARIOS.find(s => s.name === 'price-wall')!;
  const decision = perceive({ ...scenario });
  const controller = new AbortController(); let finish!: (value: { chunks: []; scores: [] }) => void, calls = 0;
  const pending = generateSafePopup({ decision, objective: scenario.objective, business: { name: 'Test' }, instructions: { businessName: 'Test', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: true, language: 'English' } },
    { signal: controller.signal, knowledge: { retrieveFn: () => new Promise(resolve => { finish = resolve; }) }, llm: { available: () => true, generateStructured: async () => { calls++; return {}; } } });
  controller.abort(new Error('page changed')); finish({ chunks: [], scores: [] });
  await assert.rejects(pending, /page changed/); await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(calls, 0);
});
test('F14: end-to-end retrieval deadline is bounded even when retrieval never settles', async () => {
  const scenario = SCENARIOS.find(s => s.name === 'price-wall')!;
  await assert.rejects(generateSafePopup({ decision: perceive({ ...scenario }), objective: scenario.objective, business: { name: 'Test' }, instructions: { businessName: 'Test', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: true, language: 'English' } },
    { timeoutMs: 5, knowledge: { retrieveFn: () => new Promise(() => {}) } }), /timed out/);
});
