import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import type { ResolvedContext, RetrievedChunk, CrawledPage } from './types.js';
import { buildChatSafetyPlan, composeSafeChatReply, validateChatDraft } from '../language/chatSafety.js';
import { priceRecords } from './sourceRecords.js';
import { planRetrieval, answerQuery } from './retrievalPlan.js';
import { selectRetrieval } from './retrievalSelection.js';
import { extract } from '../crawler/extract.js';
import { chunkPages } from '../chunking/chunker.js';
const snapshot = JSON.parse(readFileSync(new URL('./fixtures/dental-snapshot.json', import.meta.url), 'utf8'));
const documents: RetrievedChunk[] = snapshot.documents.map((d: RetrievedChunk) => ({ ...d, score: .9 }));
const pricing = documents.find(d => d.page === '/pricing')!;
const language = { language: 'English', explicit: false } as const;
const context = (chunks = documents): ResolvedContext => ({ websiteId: 'dental', business: { name: 'Dental' },
  instructions: { businessName: 'Dental', websiteUrl: snapshot.sourceUrl, language: 'English', tone: 'concise', alwaysBookDemo: false, avoidDiscounts: true }, chunks, businessActions: [], siteLinks: [], source: 'rag', scores: chunks.map(d => d.score) });
const reply = (q: string, chunks = documents) => composeSafeChatReply(buildChatSafetyPlan(context(chunks), q, language));
for (const query of ['Composite White Cavity Filling', 'How much is a composite white cavity filling?', 'composite filling price?', 'white cavity fillings cost?', 'composit white cavity filling price?']) test(`existing snapshot range and condition: ${query}`, () => {
  const value = reply(query); assert.match(value, /\$180–\$290/); assert.match(value, /Depends on size of restoration/); assert.ok(value.length < 200);
});
for (const query of ['How much does teeth whitening cost?', 'teeth whitening price?', 'teeth whitning cost?', 'teeth whitening kitne ka hai?', 'teeth whitening ka daam batao']) test(`existing snapshot whitening: ${query}`, () => {
  const plan = buildChatSafetyPlan(context(), query, query.includes('hai') || query.includes('batao') ? { language: 'Hinglish', explicit: false } : language);
  const value = composeSafeChatReply(plan); assert.equal(plan.state, 'known_positive'); assert.match(value, /\$399/); assert.match(value, /In-office 60-minute session/); assert.doesNotMatch(value, /\p{Script=Devanagari}/u);
});
test('broad pricing/services answer concisely from records rather than forcing navigation', () => {
  for (const q of ['Pricing', 'What is your pricing?', 'Services', 'What services do you offer?', 'What treatments are available?', 'services kya hai?']) { const value = reply(q); assert.match(value, /Composite White Cavity Filling/); assert.match(value, /Teeth Whitening/); assert.ok(value.length < 900); assert.doesNotMatch(value, /couldn't|Which treatment/); }
});
test('contact details preserve central, urgent-only hotline and email distinctions', () => {
  const value = reply('contact details'); for (const text of ['(800) 555-8801', '(800) 555-8899', 'Urgent calls only', 'support@smilecraftdental.com']) assert.ok(value.includes(text)); assert.ok(value.length < 600);
  assert.match(value, /EMAIL CHANNELS support@smilecraftdental\.com — General support/); assert.doesNotMatch(value, /comGeneral|CHANNELSsupport/);
});
test('service explanation uses a whole relevant paragraph, not a whole page', () => {
  const value = reply('Explain teeth whitening'); assert.match(value, /Eliminate stains|clinical teeth whitening|Remove years of coffee/); assert.ok(value.length < 800); assert.doesNotMatch(value, /Our Two Whitening Systems/);
});
test('specific unsupported price is unknown, not an unrelated treatment price', () => {
  for (const q of ['take home whitening kit price?', 'invisible braces price?', 'spaceship repair price?']) assert.doesNotMatch(reply(q), /costs \$|starts at \$/);
});
test('empty knowledge and foreign origin fail closed', () => {
  assert.match(reply('teeth whitening price?', []), /details about teeth whitening/);
  assert.doesNotMatch(reply('teeth whitening price?', [{ ...pricing, url: 'https://foreign.example/pricing' }]), /\$399/);
});
test('conflicting structural records block certainty including low-cosine contradictory source', () => {
  const other = { ...pricing, id: 'different', content: pricing.content.replace('$399', '$499'), score: .01 };
  const plan = planRetrieval('teeth whitening price?', [pricing, other], { sourceUrl: snapshot.sourceUrl });
  const selected = selectRetrieval([pricing, other], plan, { topK: 1, threshold: .5, maxChars: 9000, sourceUrl: snapshot.sourceUrl });
  const safety = buildChatSafetyPlan({ ...context(selected.chunks), retrieval: selected.diagnostics }, 'teeth whitening price?', language);
  assert.equal(safety.state, 'contradictory', JSON.stringify(selected.diagnostics)); assert.doesNotMatch(composeSafeChatReply(safety), /costs \$399/);
});
test('weak embeddings can recover exact structural records, but never unknown concrete subjects', () => {
  for (const q of ['teeth whitening price?', 'Pricing', 'contact details']) {
    const hits = documents.map(d => ({ ...d, score: .05 })), plan = planRetrieval(q, hits, { sourceUrl: snapshot.sourceUrl });
    const result = selectRetrieval(hits, plan, { topK: 5, threshold: .5, maxChars: 9000, sourceUrl: snapshot.sourceUrl });
    assert.ok(result.chunks.length); assert.equal(buildChatSafetyPlan({ ...context(result.chunks), retrieval: result.diagnostics }, answerQuery(q, result.diagnostics), language).state, 'known_positive');
  }
  const q = 'take home whitening kit price?', hits = [{ ...pricing, score: .05 }];
  assert.equal(selectRetrieval(hits, planRetrieval(q, hits), { topK: 5, threshold: .5, maxChars: 9000 }).chunks.length, 0);
});
test('real record labels support conversational pricing follow-up without replacing unknown subjects', () => {
  const query = 'How much?', plan = planRetrieval(query, documents, { history: ['teeth whitening'], purpose: 'chat', sourceUrl: snapshot.sourceUrl });
  const result = selectRetrieval(documents, plan, { topK: 5, threshold: .5, maxChars: 9000, sourceUrl: snapshot.sourceUrl });
  assert.equal(plan.topicSource, 'visitor_history'); assert.match(reply(answerQuery(query, result.diagnostics), result.chunks), /\$399/);
});
test('valid price draft keeps all qualifiers; stripped or invented claims fail validation', () => {
  const plan = buildChatSafetyPlan(context(), 'teeth whitening price?', language);
  assert.equal(validateChatDraft(plan.selected[0].text, plan).ok, true);
  for (const draft of ['Philips Zoom Laser Teeth Whitening costs $399.', plan.selected[0].text + ' Your appointment is confirmed.', 'Philips Zoom Laser Teeth Whitening costs $39.']) assert.equal(validateChatDraft(draft, plan).ok, false);
});
test('table row, comparison column, heading and card formats preserve currency, units and conditions', () => {
  const bodies = [
    '<table><thead><tr><th>Service</th><th>Price</th><th>Conditions</th></tr></thead><tbody><tr><td>Garden Design</td><td>€120 - €190</td><td>Per visit, excluding VAT</td></tr></tbody></table>',
    '<section><h2>Garden Design</h2><p>€120 - €190</p><p>Per visit, excluding VAT</p></section>',
    '<div><div><span>Garden Design</span><span>Per visit, excluding VAT</span></div><div><span>€120 - €190</span></div></div>',
    '<table><thead><tr><th>Plan</th><th>Garden Design</th><th>Other</th></tr></thead><tbody><tr><th>Price</th><td>€120 - €190</td><td>€250</td></tr><tr><th>Conditions</th><td>Per visit, excluding VAT</td><td>Annual only</td></tr></tbody></table>',
  ];
  for (const body of bodies) {
    const parsed = extract(`<main>${body}</main>`, snapshot.sourceUrl + 'pricing');
    const page: CrawledPage = { url: snapshot.sourceUrl + 'pricing', path: '/pricing', title: 'Pricing', text: parsed.text, sections: parsed.sections, pageType: 'pricing', contentHash: '', lastCrawled: '' };
    const chunks = chunkPages([page], 'English').map(d => ({ ...d, score: .9 }));
    const records = chunks.flatMap(priceRecords), record = records.find(r => r.subject === 'Garden Design');
    assert.ok(record, JSON.stringify(parsed.sections)); assert.equal(record.amount, '€120–€190'); assert.match(record.qualification, /Per visit, excluding VAT/);
  }
});
test('current downloaded Dental HTML survives real extract and chunk pipeline', () => {
  const html = readFileSync(new URL('./fixtures/dental-pricing.html', import.meta.url), 'utf8'), parsed = extract(html, pricing.url);
  const chunks = chunkPages([{ url: pricing.url, path: '/pricing', title: parsed.title, text: parsed.text, sections: parsed.sections, pageType: 'pricing', contentHash: '', lastCrawled: '' }], 'English').map(c => ({ ...c, score: .9 }));
  assert.match(reply('teeth whitening price?', chunks), /\$399.*In-office 60-minute session/s);
  assert.match(reply('composite filling price?', chunks), /\$180–\$290.*Depends on size of restoration/s);
});
