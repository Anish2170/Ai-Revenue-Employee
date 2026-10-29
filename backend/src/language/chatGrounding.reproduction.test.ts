import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = ''; process.env.DEBUG_TRACE = 'false';
const { streamChatReply } = await import('../services/chatService.js');
const { __setProvidersForTests } = await import('../llm/index.js');
const { getWebsiteStore } = await import('../vectorstore/registry.js');
const { config } = await import('../config/index.js');
const { detectedChatLanguage } = await import('./chatLanguage.js');
const facts = [
  'Dental cleaning starts at ₹1,200.', 'Root canal treatment starts at ₹4,500.',
  'The clinic opens Monday to Saturday, 9 AM to 7 PM.', 'The clinic is closed on Sunday.',
  "Appointment cancellations require 24 hours' notice.", 'Consultation fees are non-refundable.',
  'Online booking is available.', 'Emergency dental treatment is not offered.',
];
const instructions = { businessName: 'NovaCare Clinic', language: 'English', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: true, websiteUrl: 'https://novacare.test' };
async function reply(t: import('node:test').TestContext, query: string, draft: string) {
  const websiteId = 'chat-grounding-reproduction';
  const { store } = await getWebsiteStore(websiteId);
  store.import(facts.map((content, i) => ({ id: `fact-${i}`, content, heading: 'Clinic facts', title: 'Clinic facts', page: '/facts', url: 'https://novacare.test/facts', pageType: 'faq', section: '', language: 'English', hash: '', lastCrawled: new Date().toISOString(), embedding: [1, 0] })));
  const originalKey = config.gemini.apiKey; (config.gemini as { apiKey: string }).apiKey = 'synthetic';
  t.after(() => { (config.gemini as { apiKey: string }).apiKey = originalKey; __setProvidersForTests(null, null); });
  t.mock.method(globalThis, 'fetch', async () => Response.json({ embeddings: [{ values: [1, 0] }] }));
  __setProvidersForTests({ id: 'synthetic-unsafe-draft', async *streamText() { yield draft; }, async generateStructured() { throw Error('unexpected'); }, async embed() { throw Error('unexpected'); } }, null);
  const stream = await streamChatReply({ messages: [{ role: 'user', content: query }], tenant: { websiteId, instructions } });
  let text = ''; for await (const event of stream) if (event.type === 'token') text += event.text;
  return text;
}
for (const [query, unsafe] of [
  ['Do you offer dental implants?', 'We do not offer dental implants.'],
  ['क्या आप घर पर इलाज करते हैं?', 'हम घर पर इलाज की सेवा नहीं देते हैं।'],
  ['Kya aap free consultation dete ho?', 'Nahi, free consultation available nahi hai.'],
]) test(`missing evidence must not authorize denial: ${query}`, async t => {
  const answer = await reply(t, query, unsafe); assert.notEqual(answer, unsafe);
  assert.match(answer, /confirm|verified|जानकारी|पुष्टि/i);
});
for (const offer of [
  'I can email you available consultation times.', 'Our treatment checklist is ready.',
  'We have a useful appointment guide.', 'I have emailed your guide.', 'Your appointment is confirmed.',
]) test(`unsupported capability draft must not reach visitor: ${offer}`, async t => {
  const answer = await reply(t, 'What is the price of dental cleaning?', `Dental cleaning starts at ₹1,200. ${offer}`);
  assert.ok(!answer.includes(offer)); assert.ok(answer.includes('₹1,200'));
});
test('business homepage is not a verified booking destination', async t => {
  const answer = await reply(t, 'Where can I book online?', 'Online booking is available. Book at https://novacare.test.');
  assert.ok(!answer.includes('https://novacare.test')); assert.match(answer, /booking|link|confirm/i);
});
for (const query of ['Kal khula hai?', 'Kitna lagega?', 'Refund milega kya?', 'Booking ho jayegi?', 'Aaj open ho?', 'Sunday ko band hai?']) test(`short Roman Hindi stays Hinglish: ${query}`, () => {
  assert.equal(detectedChatLanguage(query), 'Hinglish');
});
