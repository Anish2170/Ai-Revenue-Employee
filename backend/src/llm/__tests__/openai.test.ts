import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from '../../config/index.js';
import { createOpenAIProvider } from '../provider/openai.js';
import { popupJsonSchema } from '../../validation/popupSchema.js';

// Tests temporarily override the runtime config; production exposes it readonly.
const primaryConfig = config.llm.primary as { model: string };

test('Luna streaming sends explicit none reasoning and preserves the chat contract', async (t) => {
  const originalModel = config.llm.primary.model;
  t.after(() => { primaryConfig.model = originalModel; });
  primaryConfig.model = 'gpt-6-luna';
  const req = { system: 'Use supplied business facts only.', messages: [{ role: 'user' as const, content: 'What are your hours?' }] };
  const fetchMock = t.mock.method(globalThis, 'fetch', async (...[url, init]: Parameters<typeof fetch>) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      model: 'gpt-6-luna', reasoning_effort: 'none', temperature: 0.6, stream: true,
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    });
    return new Response('data: {"choices":[{"delta":{"content":"Open "}}]}\n\ndata: {"choices":[{"delta":{"content":"Monday."}}]}\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  const provider = createOpenAIProvider();
  assert.equal(provider.id, 'openai:gpt-6-luna');
  let output = '';
  for await (const chunk of provider.streamText(req)) output += chunk;
  assert.equal(output, 'Open Monday.');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('Luna structured generation sends the production popup schema with strict JSON', async (t) => {
  const originalModel = config.llm.primary.model;
  t.after(() => { primaryConfig.model = originalModel; });
  primaryConfig.model = 'gpt-6-luna';
  const req = {
    system: 'Return a grounded decision.', user: 'Supplied knowledge',
    schema: popupJsonSchema,
  };
  const popup = { title: 'Support', body: 'Need help?', primaryAction: 'contact_support', secondaryAction: '', tone: 'supportive', popupType: 'support' };
  t.mock.method(globalThis, 'fetch', async (...[_url, init]: Parameters<typeof fetch>) => {
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: 'gpt-6-luna', reasoning_effort: 'none', temperature: 0.4,
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
      response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: req.schema } },
    });
    return Response.json({ choices: [{ message: { content: JSON.stringify(popup) } }] });
  });
  assert.deepEqual(await createOpenAIProvider().generateStructured(req), popup);
});

for (const [name, response] of [
  ['malformed JSON', { choices: [{ message: { content: '{broken' } }] }],
  ['empty content', { choices: [{ message: { content: '' } }] }],
  ['refusal', { choices: [{ message: { refusal: 'Cannot comply.' } }] }],
] as const) {
  test(`OpenAI popup parsing rejects ${name}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json(response));
    await assert.rejects(() => createOpenAIProvider().generateStructured({ system: 'Popup', user: 'Facts', schema: popupJsonSchema }));
  });
}

test('a non-Luna model override keeps its existing request parameters', async (t) => {
  const originalModel = config.llm.primary.model;
  t.after(() => { primaryConfig.model = originalModel; });
  primaryConfig.model = 'custom-openai-model';
  t.mock.method(globalThis, 'fetch', async (...[_url, init]: Parameters<typeof fetch>) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'custom-openai-model');
    assert.equal(Object.hasOwn(body, 'reasoning_effort'), false);
    return Response.json({ choices: [{ message: { content: '{"ok":true}' } }] });
  });
  assert.deepEqual(await createOpenAIProvider().generateStructured({ system: 'Test', user: 'Test', schema: { type: 'object' } }), { ok: true });
});
