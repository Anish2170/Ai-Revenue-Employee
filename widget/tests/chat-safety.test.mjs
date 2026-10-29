import assert from 'node:assert/strict';
import test from 'node:test';
import { browser, config } from './runtime.mjs';

test('ApiClient preserves localized server error rather than replacing it with English', async () => {
  const text = 'अभी जवाब देने में दिक्कत हो रही है।';
  const page = browser({ fetch: async () => new Response(`data: ${JSON.stringify({ error: text })}\n\ndata: [DONE]\n\n`) });
  const api = new page.ApiClient(config); api.identity = async () => ({ visitorId: 'v', sessionId: 's', visitorToken: 't' });
  let error;
  await new Promise(resolve => api.streamChat([], undefined, null, { onToken() {}, onError(value) { error = value; }, onDone: resolve }));
  assert.equal(error, text);
});

for (const saved of [true, false, undefined]) test(`lead card must not claim storage without receipt: ${saved}`, () => {
  const page = browser(); let handlers;
  const api = { streamChat(_m, _b, _id, value) { handlers = value; return () => {}; } };
  const chat = new page.ChatWindow({}, api, () => ({}), () => {}); chat.scrollToBottom = () => {};
  const button = { disabled: true, textContent: '', classList: { add() {} } };
  chat.submitLeadEmail('person@example.test', button);
  if (saved !== undefined) handlers.onLeadSaved?.(saved);
  handlers.onDone();
  assert.equal(button.textContent, saved === true ? 'Email Saved' : saved === false ? 'Try Again' : 'Submitted');
});
