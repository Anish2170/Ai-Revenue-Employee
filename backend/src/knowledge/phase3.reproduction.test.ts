import assert from 'node:assert/strict';
import test from 'node:test';
import { extract } from '../crawler/extract.js';
import { chunkPages } from '../chunking/chunker.js';
import { normalizeUrl } from '../crawler/links.js';
import { isPublicAddress } from '../security/ssrf.js';
import { BUSINESS_FIXTURES, fixtureHtml, NOVACARE_FACTS } from './phase3Fixtures.js';
const page = (text: string, url = 'https://fixture.test/policy') => ({ url, path: new URL(url).pathname, title: 'Business policy', text, pageType: 'faq' as const, contentHash: 'fixture', lastCrawled: '2026-10-25T00:00:00Z' });
for (const fact of NOVACARE_FACTS) test(`short authoritative fact survives: ${fact}`, () => {
  assert.ok(chunkPages([page(fact)], 'English').some(chunk => chunk.content.includes(fact)));
});
test('footer-only business hours survive extraction', () => {
  const f = BUSINESS_FIXTURES[0]; assert.ok(extract(fixtureHtml(f.title, f.body), 'https://fixture.test').text.includes('9 AM'));
});
test('table cells preserve boundaries between plan and qualified amount', () => {
  const f = BUSINESS_FIXTURES.find(f => f.id === 'saas')!; const text = extract(fixtureHtml(f.title, f.body), 'https://fixture.test/pricing').text;
  assert.ok(!text.includes('$10/month₹999/month')); assert.match(text, /Premium[\s\S]*₹999\/month[\s\S]*Billed annually/);
});
test('meaningful duplicate query keys are not silently collapsed', () => {
  assert.equal(new URL(normalizeUrl('https://fixture.test/products?tag=blue&tag=linen&utm_source=x')!).searchParams.getAll('tag').length, 2);
});
test('query-specific product chunk IDs remain distinct', () => {
  const prose = 'This product costs $20 per item, excluding tax. '.repeat(8);
  const chunks = chunkPages([page(prose, 'https://fixture.test/products?sku=blue'), page(prose, 'https://fixture.test/products?sku=red')], 'English');
  assert.equal(new Set(chunks.map(chunk => chunk.id)).size, chunks.length);
});
test('hex-encoded IPv4 loopback inside IPv6 cannot bypass SSRF', () => {
  assert.equal(isPublicAddress('::ffff:7f00:1'), false);
});
test('short navigation junk is not admitted by the short-fact exception', () => {
  assert.equal(chunkPages([page('Home About Contact Privacy Next Previous Sign in')], 'English').length, 0);
});
