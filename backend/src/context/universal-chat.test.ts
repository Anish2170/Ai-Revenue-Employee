import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ResolvedContext, RetrievedChunk } from './types.js';
import { buildChatSafetyPlan, composeSafeChatReply } from '../language/chatSafety.js';
import { planRetrieval, answerQuery } from './retrievalPlan.js';
import { selectRetrieval } from './retrievalSelection.js';

const language = { language: 'English', explicit: false } as const;
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/dental-snapshot.json', import.meta.url), 'utf8'));
const dental: RetrievedChunk[] = snapshot.documents.map((d: RetrievedChunk) => ({ ...d, score: .05 }));
function ctx(chunks: RetrievedChunk[], origin = snapshot.sourceUrl): ResolvedContext {
  return { websiteId: origin, business: { name: 'Fixture' }, instructions: { businessName: 'Fixture', websiteUrl: origin,
    language: 'English', tone: 'concise', alwaysBookDemo: false, avoidDiscounts: true }, chunks, businessActions: [], siteLinks: [], source: 'rag', scores: chunks.map(c => c.score) };
}
function answer(query: string, chunks = dental, origin = snapshot.sourceUrl) {
  const retrieval = selectRetrieval(chunks, planRetrieval(query, chunks, { sourceUrl: origin, purpose: 'chat' }), { topK: 5, threshold: .5, maxChars: 9000, sourceUrl: origin });
  const plan = buildChatSafetyPlan({ ...ctx(retrieval.chunks, origin), retrieval: retrieval.diagnostics }, answerQuery(query, retrieval.diagnostics), language, true);
  return { plan, text: composeSafeChatReply(plan), retrieval };
}
for (const query of ['emergency no', 'emergency contact', 'urgent helpline', 'emergency ka number', 'emergency number kya hai?', 'How do I contact you urgently?', 'आपातकालीन नंबर क्या है?', 'emergncy number']) test(`source-backed short contact: ${query}`, () => {
  const result = answer(query);
  assert.match(result.text, /\(800\) 555-8899/);
  assert.doesNotMatch(result.text, /555-8801|email address\?/);
  assert.match(result.text, /Urgent calls only|triage|Trauma Support/);
  assert.equal(result.plan.state, 'known_positive');
});
for (const query of ['kya emergency service avilabe hai?', 'kya emergency service available hai?', 'Do you offer emergency services?']) test(`qualified service description: ${query}`, () => {
  const result = answer(query);
  assert.match(result.text, /dedicated daily emergency slots|Immediate root treatments and extraction triage/);
  assert.ok(result.text.length < 800);
  assert.doesNotMatch(result.text, /email address\?|confirmed.*booking|guaranteed immediate treatment/i);
});
test('factual price does not authorize a lead question even with persistence available', () => {
  const result = answer('How much does teeth whitening cost?');
  assert.match(result.text, /\$399/); assert.equal(result.plan.leadOffer, false);
  assert.doesNotMatch(result.text, /email address/);
});

function doc(origin: string, page: string, content: string, heading = 'Details'): RetrievedChunk {
  return { id: origin + page, page, url: origin + page, pageType: 'other', title: heading, heading, section: '', hash: '', lastCrawled: '', language: 'English', content, score: .05 };
}
const fixtures = [
  { name: 'restaurant', origin: 'https://restaurant.example', topic: 'catering', contact: 'Catering hotline\n+44 20 7946 0958\nWeekdays only; no same-day orders.', number: '+44 20 7946 0958', service: 'Catering\nCatering is available for groups of 20 or more. Advance notice of 48 hours is required.', qualifier: /48 hours/ },
  { name: 'commerce', origin: 'https://shop.example', topic: 'returns', contact: 'Returns support\n+91 98765 43210\nUnopened items only; weekdays 9 AM to 5 PM.', number: '+91 98765 43210', service: 'Gift wrapping\nGift wrapping is available for boxed items only. Oversized items are excluded.', qualifier: /Oversized items are excluded/ },
  { name: 'saas', origin: 'https://saas.example', topic: 'urgent', contact: 'Urgent support hotline\n+1 (212) 555-0188\n24/7 incident triage only; Enterprise accounts.', number: '+1 (212) 555-0188', service: 'Data migration\nData migration is available for annual plans only. Third-party fees are excluded.', qualifier: /Third-party fees are excluded/ },
];
for (const f of fixtures) {
  test(`${f.name}: contact record outside /contact retains scope and qualifier`, () => {
    const result = answer(`${f.topic} ka number kya hai?`, [doc(f.origin, '/help', f.contact)], f.origin);
    assert.ok(result.text.includes(f.number), result.text); assert.match(result.text, /only/);
    assert.equal(result.plan.leadOffer, false);
  });
  test(`${f.name}: service card keeps conditions and exclusions`, () => {
    const topic = f.service.split('\n')[0];
    const result = answer(`kya ${topic} service available hai?`, [doc(f.origin, '/catalog', f.service)], f.origin);
    assert.match(result.text, f.qualifier); assert.ok(result.text.length < 600);
  });
  test(`${f.name}: foreign tenant contacts cannot enter results`, () => {
    const foreign = doc('https://other.example', '/help', f.contact);
    const result = answer(`${f.topic} number`, [foreign], f.origin);
    assert.ok(!result.text.includes(f.number)); assert.equal(result.retrieval.chunks.length, 0);
  });
}
test('a triage hotline never establishes treatment, booking, or immediate availability', () => {
  const origin = 'https://triage.example', chunks = [doc(origin, '/help', 'Emergency hotline\n+1 (212) 555-0188\n24/7 urgent-call triage only.')];
  for (const query of ['Do you have emergency treatment?', 'Is emergency booking available?', 'Is immediate treatment guaranteed?']) {
    const result = answer(query, chunks, origin);
    assert.ok(!result.plan.state.startsWith('known'), result.text);
    assert.doesNotMatch(result.text, /treatment is available|booking is available|treatment is guaranteed/);
  }
});

// Only local mocks can be used by modules initialized below.
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) process.env[key] = '';
process.env.KNOWLEDGE_STORAGE_PROVIDER = 'local';
(globalThis as any).prisma = { lead: { async upsert() { throw Error('Unexpected lead write'); } } };
const { shouldOfferContactCapture, captureLeadFromConversation } = await import('../leads/lead.service.js');
const { prisma } = await import('../db/prisma.js');
test('pricing interest and browsing behavior are not permission for capture', () => {
  assert.equal(shouldOfferContactCapture([{ role: 'user', content: 'How much does teeth whitening cost?' }], { page: '/pricing', pageTitle: 'Pricing', timeOnPage: 180 } as never), false);
});
for (const content of ['Please contact me for follow-up', 'I want to book an appointment', 'Can I request a custom quote?', 'mujhe call back karna', 'मुझे कॉल करें']) test(`explicit capture request is retained: ${content}`, () => {
  assert.equal(shouldOfferContactCapture([{ role: 'user', content }]), true);
});
test('a previous sales request cannot cause capture pressure on a later factual inquiry', () => {
  assert.equal(shouldOfferContactCapture([{ role: 'user', content: 'I want a custom quote' }, { role: 'assistant', content: 'How can I help?' }, { role: 'user', content: 'What are your hours?' }]), false);
  assert.equal(shouldOfferContactCapture([{ role: 'user', content: 'Do not contact me' }]), false);
});
test('contact information mentioned in a question is never silently saved as a lead', async t => {
  const write = t.mock.method(prisma.lead, 'upsert', async () => { throw Error('must not write'); });
  for (const content of ['Is support@example.test your support email?', 'Does my email visitor@example.test need verification?', 'Does your phone number +1 212 555 0188 work after hours?', 'Do not save my email visitor@example.test']) {
    assert.equal(await captureLeadFromConversation({ tenant: { websiteId: 'local', organizationId: 'local' }, conversationId: 'local', messages: [{ role: 'user', content }], assistantReply: 'Please use the verified support email.' }), false);
  }
  assert.equal(write.mock.callCount(), 0);
});
test('a deliberately supplied contact still saves once through the tenant-scoped delegate', async t => {
  const write = t.mock.method(prisma.lead, 'upsert', async (args: any) => { assert.equal(args.create.websiteId, 'local'); assert.equal(args.create.email, 'visitor@example.test'); return {} as never; });
  assert.equal(await captureLeadFromConversation({ tenant: { websiteId: 'local', organizationId: 'local' }, conversationId: 'local', messages: [{ role: 'user', content: 'Please contact me at visitor@example.test' }], assistantReply: 'Thank you for sharing your email for follow-up.' }), true);
  assert.equal(write.mock.callCount(), 1);
});
test('how-to booking instructions alone do not request contact capture', () => {
  assert.equal(shouldOfferContactCapture([{ role: 'user', content: 'How do I book an appointment?' }]), false);
});
test('conflicting contact values cannot be hidden by Top-K or low cosine', () => {
  const origin = 'https://conflict.example', first = doc(origin, '/help', 'Urgent hotline\n+1 (212) 555-0188\n24/7 incident triage only.');
  const second = { ...first, id: 'second', url: origin + '/policy', content: first.content.replace('0188', '0199'), score: .01 };
  const result = answer('urgent number', [first, second], origin);
  assert.equal(result.plan.state, 'contradictory'); assert.doesNotMatch(result.text, /555-0188/);
});
test('conflicting service cards preserve uncertainty rather than quoting one as available', () => {
  const origin = 'https://conflict.example', first = doc(origin, '/catalog', 'Catering\nCatering is available for groups of 20 or more.');
  const second = doc(origin, '/policy', 'Catering\nCatering is not available.');
  const result = answer('Is catering available?', [first, second], origin);
  assert.equal(result.plan.state, 'contradictory'); assert.doesNotMatch(result.text, /source says/);
});
for (const f of fixtures) test(`${f.name}: prices/ranges, hours, policy, relevant follow-up and missing facts`, () => {
  const priced = doc(f.origin, '/pricing', 'Standard package | $40 - $60 | Per order; excluding tax', 'Standard package');
  const hours = { ...doc(f.origin, '/hours', 'The business opens Monday to Saturday, 9 AM to 7 PM.'), score: .9 };
  const policy = { ...doc(f.origin, '/policy', 'Returns are accepted within 30 days for unopened products.'), score: .9 };
  const chunks = [priced, hours, policy];
  assert.match(answer('standard package kitne ka hai?', chunks, f.origin).text, /\$40–\$60.*excluding tax/s);
  assert.match(answer('What are your opening hours?', chunks, f.origin).text, /Monday to Saturday.*9 AM to 7 PM/);
  assert.match(answer('What is your refund policy?', chunks, f.origin).text, /within 30 days for unopened products/);
  assert.equal(answer('unknown package price?', chunks, f.origin).plan.state, 'unknown');
  const plan = planRetrieval('How much?', chunks, { history: ['Standard package'], sourceUrl: f.origin, purpose: 'chat' });
  const result = selectRetrieval(chunks, plan, { topK: 5, threshold: .5, maxChars: 9000, sourceUrl: f.origin });
  assert.match(composeSafeChatReply(buildChatSafetyPlan(ctx(result.chunks, f.origin), answerQuery('How much?', result.diagnostics), language)), /\$40–\$60/);
});
