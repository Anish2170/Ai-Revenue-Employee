import assert from 'node:assert/strict';
import test from 'node:test';
import { browser } from './runtime.mjs';

for (const text of ["What's the best email address to send it to?", 'आप अपना ईमेल पता बताएंगे?', 'क्या आप अपना ईमेल बता सकते हैं?', 'Aap apna email address bataiye?', 'Kis email par bhejun?']) test(`email card recognizes conversational offer: ${text}`, () => {
  assert.equal(browser().asksForLeadEmail(text), true);
});
for (const text of ['No thanks, do not email me.', 'आपका ईमेल नहीं चाहिए।', 'Abhi nahi, email mat bhejein.', 'We offer email support.', 'हमें ईमेल करें।']) test(`email card avoids decline/unrequested card: ${text}`, () => {
  assert.equal(browser().asksForLeadEmail(text), false);
});

function fixture() {
  const page = browser();
  page.context.document.createElement = () => ({ appendChild() {}, append() {} });
  let outbound;
  const api = { streamChat(messages, _behaviour, _id, handlers) { outbound = messages; handlers.onError('अभी जवाब देने में दिक्कत हो रही है।'); handlers.onDone(); return () => {}; } };
  const chat = new page.ChatWindow({}, api, () => ({}), () => {});
  const bubble = { textContent: '', appendChild() {} };
  chat.appendBubble = () => bubble;
  chat.history = [{ role: 'assistant', content: 'Hi! How can I help?' }, { role: 'user', content: 'Please reply in Hindi.' }, { role: 'assistant', content: 'ज़रूर।' }, { role: 'user', content: 'Pricing' }];
  return { chat, bubble, outbound: () => outbound };
}
test('localized server error survives onDone rather than being overwritten by English fallback', () => {
  const f = fixture(); f.chat.streamReply('Pricing');
  assert.equal(f.bubble.textContent, 'अभी जवाब देने में दिक्कत हो रही है।');
});
test('stateless chat sends bounded history to preserve explicit language choice', () => {
  const f = fixture(); f.chat.conversationId = null; f.chat.streamReply('Pricing');
  assert.ok(f.outbound().some(message => message.content === 'Please reply in Hindi.'));
  assert.ok(f.outbound().length <= 50);
});
test('durable conversation still sends only latest turn/pending opener, avoiding duplicate transcript persistence', () => {
  const f = fixture(); f.chat.conversationId = 'stored-conversation'; f.chat.streamReply('Pricing');
  assert.equal(f.outbound().length, 1); assert.equal(f.outbound()[0].content, 'Pricing');
});
test('returning chat resumes without injecting an English popup transition over visitor language', () => {
  const f = fixture(); assert.equal(f.chat.naturalTransition('English popup body'), '');
  f.chat.history = []; assert.match(f.chat.naturalTransition('English popup body'), /What would you like to know/);
});
