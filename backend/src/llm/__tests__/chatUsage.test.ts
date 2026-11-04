import assert from 'node:assert/strict';
import test from 'node:test';
import type { TokenUsage } from '../provider/types.js';
for (const key of ['DATABASE_URL', 'GEMINI_API_KEY', 'OPENAI_API_KEY']) process.env[key] = '';
const { createOpenAIProvider } = await import('../provider/openai.js');
const { createGeminiProvider } = await import('../provider/gemini.js');
const { config } = await import('../../config/index.js');
test('OpenAI streaming reports actual token/cache usage and sends the output bound', async t => {
 const usage: TokenUsage[] = [];
 t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
  const body = JSON.parse(String(options?.body)); assert.deepEqual(body.stream_options, { include_usage: true }); assert.equal(body.max_completion_tokens, 700);
  return new Response('data: {"choices":[{"delta":{"content":"Hello."}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":2000,"completion_tokens":50,"prompt_tokens_details":{"cached_tokens":1000,"cache_write_tokens":500},"completion_tokens_details":{"reasoning_tokens":0}}}\n\ndata: [DONE]\n\n');
 });
 let text = ''; for await (const token of createOpenAIProvider().streamText({ system: 'Facts', messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 700, onUsage: u => usage.push(u) })) text += token;
 assert.equal(text, 'Hello.'); assert.equal(usage.length, 1);
 assert.deepEqual(usage[0], { provider: 'openai', model: config.llm.primary.model, inputTokens: 2000, outputTokens: 50, cachedInputTokens: 1000, cacheWriteTokens: 500, reasoningTokens: 0 });
});
test('missing usage is not reported as zero-cost; incomplete SSE is rejected', async t => {
 const usage: TokenUsage[] = [];
 t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"delta":{"content":"Incomplete"}}]}\n\n'));
 await assert.rejects(async () => { for await (const _ of createOpenAIProvider().streamText({ system: '', messages: [{ role: 'user', content: 'Hi' }], onUsage: u => usage.push(u) })) {} }, /ended before completion/);
 assert.equal(usage.length, 0);
});
test('truncated generation remains rejected while final usage is recorded', async t => {
 let usage = 0;
 t.mock.method(globalThis, 'fetch', async () => new Response('data: {"choices":[{"finish_reason":"length","delta":{"content":"Partial"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":700}}\n\ndata: [DONE]\n\n'));
 await assert.rejects(async () => { for await (const _ of createOpenAIProvider().streamText({ system: '', messages: [{ role: 'user', content: 'Hi' }], onUsage: u => { usage = u.outputTokens; } })) {} }, /truncated/);
 assert.equal(usage, 700);
});
test('Gemini reports final cumulative usage once and respects the output bound', async t => {
 const previous = config.gemini.apiKey; Object.assign(config.gemini, { apiKey: 'mock-only' }); t.after(() => Object.assign(config.gemini, { apiKey: previous }));
 const usage: TokenUsage[] = [];
 t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
  assert.equal(JSON.parse(String(options?.body)).generationConfig.maxOutputTokens, 700);
  return new Response('data: {"candidates":[{"content":{"parts":[{"text":"Hello."}],"role":"model"}}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":1}}\n\ndata: {"candidates":[],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20,"cachedContentTokenCount":50,"thoughtsTokenCount":3}}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
 });
 for await (const _ of createGeminiProvider().streamText({ system: '', messages: [{ role: 'user', content: 'Hi' }], maxOutputTokens: 700, onUsage: u => usage.push(u) })) {}
 assert.equal(usage.length, 1); assert.equal(usage[0].inputTokens, 100); assert.equal(usage[0].outputTokens, 23); assert.equal(usage[0].cachedInputTokens, 50);
});
test('Gemini preserves review enum values in the native response schema', async t => {
 const previous = config.gemini.apiKey; Object.assign(config.gemini, { apiKey: 'mock-only' }); t.after(() => Object.assign(config.gemini, { apiKey: previous }));
 t.mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
  assert.deepEqual(JSON.parse(String(options?.body)).generationConfig.responseSchema.properties.reason.enum, ['supported', 'missing_answer']);
  return Response.json({ candidates: [{ content: { parts: [{ text: '{"reason":"supported"}' }] } }] });
 });
 assert.deepEqual(await createGeminiProvider().generateStructured({ system: 'Return only supplied labels.', user: 'Fixture', schema: { type: 'object', properties: { reason: { type: 'string', enum: ['supported', 'missing_answer'] } }, required: ['reason'] } }), { reason: 'supported' });
});
