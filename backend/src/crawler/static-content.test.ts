import assert from 'node:assert/strict';
import test from 'node:test';
import { extract } from './extract.js';
import { usefulBusinessText } from './contentPolicy.js';
import { buildChunks } from '../chunking/chunker.js';

process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const { crawl } = await import('./crawler.js');
const { ingest } = await import('../services/ingestService.js');

// Short sections from unrelated fields must not depend on an industry keyword list.
const descriptions = [
  ['legal', 'Our Practice Areas', 'Lexora Legal provides elite, corporate-focused transactional and defensive counsel. Select a practice segment below to review specific deliverables.'],
  ['intellectual-property', 'Intellectual Property', "In the knowledge economy, intellectual property is often a company's most valuable asset. Our IP division helps tech builders, startups, and established brands clear, register, and enforce their patent, trademark, and copyright portfolios."],
  ['real-estate', 'Real Estate & Construction', 'Real estate acquisition and construction projects are capital-intensive operations governed by strict local codes, easement regulations, and contract terms. Our real estate division advises developers, investors, and commercial tenants on zoning filings, syndication agreements, and landlord negotiations.'],
  ['resources', 'Resource Library', 'Lexora Legal provides expert, structured literature to help founders and corporate managers navigate early transaction and compliance requirements.'],
  ['blog', 'Legal Insights', 'Expert legal analysis, regulatory alerts, and transactional guidance written by Lexora Legal partners.'],
  ['education', 'Research Methods', 'Students investigate primary sources, evaluate competing explanations, and present their findings through independent written assignments.'],
  ['accounting', 'Financial Reporting', 'Our accountants reconcile ledgers, prepare statutory filings, and explain reporting obligations to directors and shareholders.'],
  ['manufacturing', 'Precision Engineering', 'We manufacture precision components from certified alloys, following documented tolerances and independent inspection procedures.'],
  ['nonprofit', 'Community Literacy', 'Volunteers pair with adult readers to develop confidence, practise reading, and explore books together.'],
  ['software', 'Audit Trails', 'Administrators can export access histories, investigate changes, and assign permissions independently for each workspace.'],
  ['healthcare', 'Clinical Assessment', 'Our clinicians evaluate symptoms, explain diagnostic findings, and discuss appropriate next steps with each patient.'],
  ['hindi', 'हमारा काम', 'हमारी टीम स्थानीय उद्यमियों के साथ काम करती है और उनके व्यवसाय के लिए आवश्यक दस्तावेज तैयार करती है।'],
] as const;
const origin = 'https://static-content.invalid';
const html = (heading: string, description: string, extra = '') => `<html><head><title>${heading}</title></head><body><nav><a href="/">Home</a></nav><main id="app"><h1>${heading}</h1><p>${description}</p>${extra}</main><script src="/_next/app.js"></script></body></html>`;

for (const [path, heading, description] of descriptions) {
  test(`readable ${path} prose survives HTTP extraction and chunking`, () => {
    const url = `${origin}/${path}`;
    const parsed = extract(html(heading, description), url);
    assert.equal(usefulBusinessText(description), true);
    assert.equal(parsed.needsRendering, false);
    assert.ok(parsed.meaningfulChars > 0);
    const result = buildChunks([{ url, path: `/${path}`, title: heading, text: parsed.text, sections: parsed.sections, pageType: 'other', contentHash: path, lastCrawled: '' }], 'English');
    assert.ok(result.chunks.some(chunk => chunk.content.includes(description)));
  });
}

const bulletItems = [
  'Board structure advisories and corporate governance rules',
  'Patent filings and trademark clearance audits',
  'Workplace compliance audits and employee incentive arrangements',
];
test('substantive bullet lists survive without sentence punctuation or industry keywords', () => {
  const parsed = extract(html('Practice areas', '', `<ul>${bulletItems.map(item => `<li>${item}</li>`).join('')}</ul>`), `${origin}/practice`);
  assert.equal(parsed.needsRendering, false);
  assert.equal(usefulBusinessText(parsed.text), true);
  const chunks = buildChunks([{ url: `${origin}/practice`, path: '/practice', title: 'Practice areas', text: parsed.text, sections: parsed.sections, pageType: 'other', contentHash: 'list', lastCrawled: '' }], 'English').chunks;
  assert.ok(chunks.some(chunk => bulletItems.every(item => chunk.content.includes(item))));
});

for (const text of ['Home About Contact Privacy Next Previous Sign in', 'Home\n\nAbout us\n\nContact us\n\nPrivacy policy\n\nTerms and conditions', 'Corporate Law\n\nIntellectual Property\n\nTax Law']) {
  test(`navigation and bare labels remain low value: ${text.slice(0, 25)}`, () => assert.equal(usefulBusinessText(text), false));
}

test('substantive prose cannot hide a real loading placeholder or explicit busy state', () => {
  const [, heading, description] = descriptions[0];
  for (const extra of ['<p>Loading content, please wait.</p>', '<section aria-busy="true"></section>', '<section class="skeleton"></section>']) {
    assert.equal(extract(html(heading, description, extra), origin).needsRendering, true);
  }
});

test('mixed-industry HTTP crawl reaches searchable ingestion without a browser', async () => {
  const [, heading, description] = descriptions[0];
  const routes = new Map(descriptions.map(([path, title, text]) => [`/${path}`, html(title, text)]));
  routes.set('/', html(heading, description, descriptions.map(([path, title]) => `<a href="/${path}">${title}</a>`).join('')));
  const result = await crawl(origin, { mode: 'auto' }, {
    fetch: async url => ({ url, status: routes.has(new URL(url).pathname) ? 200 : 404, headers: { 'content-type': 'text/html' }, body: Buffer.from(routes.get(new URL(url).pathname) ?? '') }),
    sleep: async () => {},
  });
  assert.equal(result.manifest.completeWithinScope, true);
  assert.equal(result.manifest.failed, 0);
  assert.equal(result.manifest.rendered, 0);
  let embeddedChunks = 0;
  const built = await ingest(origin, { websiteId: 'static-content', organizationId: 'fixture', snapshotId: 'candidate' }, {
    crawl: async () => result,
    previous: async () => null,
    actions: async () => ({ generatedAt: new Date().toISOString(), source: 'crawl', nodes: [] }),
    embed: async chunks => { embeddedChunks = chunks.length; return chunks.map(chunk => ({ ...chunk, embedding: [1, 0] })); },
    write: async snapshot => ({ provider: 'LOCAL', storageKey: 'fixture', contentSha256: 'fixture', contentBytes: JSON.stringify(snapshot).length, etag: null }),
  });
  assert.ok(embeddedChunks > 0);
  assert.equal(built.snapshot.publication?.completeness, 'complete');
  for (const [path, , text] of descriptions) {
    assert.ok(built.snapshot.documents.some(chunk => chunk.url === `${origin}/${path}` && chunk.content.includes(text)), `Missing searchable ${path} content`);
  }
});
