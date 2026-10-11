import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { config } from '../../config/index.js';
import { createGeminiProvider } from '../provider/gemini.js';
import type { StreamRequest } from '../provider/types.js';

const structured = {
  system: 'Answer only from business knowledge.', user: 'Supplied business facts',
  schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
};
const chat: StreamRequest = {
  system: structured.system,
  messages: [
    { role: 'user', content: 'What do you offer?' },
    { role: 'assistant', content: 'Website support.' },
    { role: 'user', content: 'What are your hours?' },
  ],
};

function setup(t: TestContext) {
  const geminiConfig = config.gemini as { apiKey: string };
  const original = geminiConfig.apiKey;
  geminiConfig.apiKey = 'unit-test-google-key';
  t.after(() => { geminiConfig.apiKey = original; });
}

async function collect(source: AsyncIterable<string>): Promise<string> {
  let output = '';
  for await (const text of source) output += text;
  return output;
}

for (const model of ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite-2026-07', 'gemini-2.5-flash']) {
  const modern = model.startsWith('gemini-3.5-flash-lite');
  test(`${model}: structured JSON works through the installed SDK with correct parameters`, async (t) => {
    setup(t);
    const fetchMock = t.mock.method(globalThis, 'fetch', async (...[url, init]: Parameters<typeof fetch>) => {
      assert.ok(String(url).includes(`${model}:generateContent`));
      const body = JSON.parse(String(init?.body));
      assert.equal(body.generationConfig.responseMimeType, 'application/json');
      assert.deepEqual(body.generationConfig.responseSchema, {
        type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'],
      });
      assert.equal(Object.hasOwn(body.generationConfig, 'temperature'), !modern);
      if (!modern) assert.equal(body.generationConfig.temperature, 0.4);
      assert.equal(Object.hasOwn(body.generationConfig, 'thinkingConfig'), false);
      assert.deepEqual(body.contents, [{ role: 'user', parts: [{ text: structured.user }] }]);
      assert.equal(body.systemInstruction.parts[0].text, structured.system);
      return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: '{"title":"Support"}' }] } }] });
    });
    assert.deepEqual(await createGeminiProvider(model).generateStructured(structured), { title: 'Support' });
    assert.equal(fetchMock.mock.callCount(), 1);
  });

  test(`${model}: streaming preserves history and uses correct parameters through the installed SDK`, async (t) => {
    setup(t);
    const fetchMock = t.mock.method(globalThis, 'fetch', async (...[url, init]: Parameters<typeof fetch>) => {
      assert.ok(String(url).includes(`${model}:streamGenerateContent`));
      const body = JSON.parse(String(init?.body));
      assert.equal(Object.hasOwn(body.generationConfig ?? {}, 'temperature'), !modern);
      if (!modern) assert.equal(body.generationConfig.temperature, 0.6);
      assert.deepEqual(body.contents, chat.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
      })));
      assert.equal(body.systemInstruction.parts[0].text, chat.system);
      return new Response(
        ['Open ', 'Monday.'].map((text) => `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })}\n\n`).join(''),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    assert.equal(await collect(createGeminiProvider(model).streamText(chat)), 'Open Monday.');
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test('Flash-Lite rejects model prefills and empty conversations without an API request', async (t) => {
  setup(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected API request'); });
  for (const messages of [[], chat.messages.slice(0, 2), [...chat.messages.slice(0, 2), { role: 'user' as const, content: ' ' }]]) {
    await assert.rejects(() => collect(createGeminiProvider('gemini-3.5-flash-lite').streamText({ system: chat.system, messages })), /last non-empty message.*user turn/);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('fallback model migration leaves embedding model and retrieval task configuration unchanged', async (t) => {
  setup(t);
  t.mock.method(globalThis, 'fetch', async (...[url, init]: Parameters<typeof fetch>) => {
    assert.ok(String(url).includes(`${config.gemini.embeddingModel}:batchEmbedContents`));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.requests[0].taskType, 'RETRIEVAL_QUERY');
    return Response.json({ embeddings: [{ values: [0.1, 0.2] }] });
  });
  assert.deepEqual(await createGeminiProvider('gemini-3.5-flash-lite').embed(['opening hours'], 'query'), [[0.1, 0.2]]);
});
