import assert from 'node:assert/strict';
import test from 'node:test';
import { planRetrieval, answerQuery } from './retrievalPlan.js';
import { selectRetrieval } from './retrievalSelection.js';
import { buildChatSafetyPlan, composeSafeChatReply } from '../language/chatSafety.js';
import type { RetrievedChunk, ResolvedContext } from './types.js';
import { ownerAction } from '../intelligence/__tests__/phase26Fixtures.js';
const origin = 'https://dental.example';
const doc = (path: string, heading: string, content: string): RetrievedChunk => ({
  id: path, url: origin + path, page: path, pageType: 'other', heading, title: 'Dental',
  content, score: .9, section: '', language: 'English', hash: '', lastCrawled: '',
});
const doctors = doc('/doctors', 'Read Bio & Credentials →Book Visit', 'Meet our dentists.');
const pricing = doc('/pricing', '$299/yearSign Up & Book Exam', 'Dental cleaning starts at $120 per visit.');
const ctx = (chunks: RetrievedChunk[]): ResolvedContext => ({
  websiteId: 'dental', business: { name: 'Dental' }, instructions: { businessName: 'Dental', websiteUrl: origin,
    language: 'English', tone: 'concise', alwaysBookDemo: false, avoidDiscounts: true },
  chunks, businessActions: [], siteLinks: [], source: 'rag', scores: chunks.map(c => c.score),
});
for (const query of ['Pricing', 'Services']) test(`manual query keeps explicit intent instead of page CTA: ${query}`, () => {
  const plan = planRetrieval(query, [doctors, pricing], { page: { path: '/doctors' }, sourceUrl: origin, purpose: 'chat' });
  const result = selectRetrieval([doctors, pricing], plan, { topK: 5, threshold: .5, maxChars: 9000, sourceUrl: origin });
  assert.equal(answerQuery(query, result.diagnostics), query);
  assert.deepEqual(plan.subjects, []);
  if (query === 'Pricing') assert.ok(result.chunks.some(c => c.id === '/pricing'));
});
test('real referential pricing follow-up still resolves a supported product', () => {
  const premium = doc('/premium', 'Premium plan', 'Premium plan costs $20 per month.');
  const plan = planRetrieval('How much does this cost?', [premium], { page: { path: '/premium' }, sourceUrl: origin });
  const result = selectRetrieval([premium], plan, { topK: 5, threshold: .5, maxChars: 9000, sourceUrl: origin });
  assert.equal(answerQuery(plan.originalQuery, result.diagnostics), 'Premium plan price?');
});
test('contact question uses verified navigation instead of quoting a whole locations page', () => {
  const location = doc('/locations', 'Locations', 'Contact details\n' + 'Clinic locations and public transit information. '.repeat(30));
  const context = ctx([location]);
  const plan = buildChatSafetyPlan(context, 'contact details', { language: 'English', explicit: false });
  const reply = composeSafeChatReply(plan);
  assert.ok(reply.length < 500, `reply length ${reply.length}`);
  assert.ok(!reply.includes(location.content));
});
test('general source excerpt remains whole, bounded and preserves qualifications', () => {
  const short = doc('/care', 'Care', 'Dental care includes regular checkups. Conditions apply.');
  const plan = buildChatSafetyPlan(ctx([short]), 'Dental care', { language: 'English', explicit: false });
  assert.ok(composeSafeChatReply(plan).includes(short.content));
});
test('verified pricing and contact navigation answer broad queries without inventing table facts', () => {
  const context = ctx([doc('/pricing', 'Book Exam', 'ExamCovered by insurance\n$85\nConditions apply.')]);
  context.websiteId = 'tenant-a'; context.instructions.websiteUrl = 'https://example.test';
  context.businessActions = [ownerAction('pricing', 'Pricing & Financing', '/pricing'), ownerAction('contact', 'Contact', '/contact')];
  for (const [query, url] of [['Pricing', '/pricing'], ['contact details', '/contact']]) {
    const plan = buildChatSafetyPlan(context, query, { language: 'English', explicit: false });
    const reply = composeSafeChatReply(plan);
    assert.ok(reply.includes('https://example.test' + url));
    assert.ok(!reply.includes('$85')); assert.ok(!reply.includes('online booking'));
    assert.ok(reply.length < 250);
  }
});
for (const invalid of ['disabled', 'cross-tenant', 'changed-destination', 'unsafe-label'] as const) test(`navigation cannot bypass authority: ${invalid}`, () => {
  const context = ctx([]); context.websiteId = 'tenant-a'; context.instructions.websiteUrl = 'https://example.test';
  const action = ownerAction('pricing', 'View Pricing', '/pricing');
  if (invalid === 'disabled') action.enabled = false;
  if (invalid === 'cross-tenant') action.authority!.websiteId = 'other-tenant';
  if (invalid === 'changed-destination') action.destination = 'https://evil.test/pricing';
  if (invalid === 'unsafe-label') { action.label = 'Free implants today'; action.authority!.label = action.label; }
  context.businessActions = [action];
  const reply = composeSafeChatReply(buildChatSafetyPlan(context, 'Pricing', { language: 'English', explicit: false }));
  assert.ok(!reply.includes('https://')); assert.ok(!reply.includes('Free implants'));
});
test('unsupported demo does not claim an appointment integration or a booking failure', () => {
  const plan = buildChatSafetyPlan(ctx([]), 'Book Demo', { language: 'English', explicit: false });
  assert.equal(plan.state, 'unknown'); assert.match(composeSafeChatReply(plan), /product demo/);
  assert.ok(!composeSafeChatReply(plan).includes('booking link'));
});
test('a real configured demo action remains usable; an appointment cannot substitute for it', () => {
  const context = ctx([]); context.websiteId = 'tenant-a'; context.instructions.websiteUrl = 'https://example.test';
  context.businessActions = [ownerAction('book_demo', 'Book Demo', '/demo')];
  const reply = composeSafeChatReply(buildChatSafetyPlan(context, 'Book Demo', { language: 'English', explicit: false }));
  assert.equal(reply, 'You can request a demo here: https://example.test/demo');
  context.chunks = [{ ...doc('/demo', 'Demo', 'Product demo is not offered.'), url: 'https://example.test/demo' }];
  assert.equal(buildChatSafetyPlan(context, 'Book Demo', { language: 'English', explicit: false }).state, 'contradictory');
  context.chunks = [];
  context.businessActions = [ownerAction('book_appointment', 'Book Appointment', '/appointments')];
  const unsupported = composeSafeChatReply(buildChatSafetyPlan(context, 'Book Demo', { language: 'English', explicit: false }));
  assert.ok(!unsupported.includes('https://example.test/appointments'));
  assert.match(unsupported, /product demo/);
});
test('long general prose never becomes an unbounded verbatim reply', () => {
  const content = 'Dental care details. '.repeat(60);
  const reply = composeSafeChatReply(buildChatSafetyPlan(ctx([doc('/care', 'Care', content)]), 'Dental care', { language: 'English', explicit: false }));
  assert.ok(reply.length < 500); assert.ok(!reply.includes(content));
});
