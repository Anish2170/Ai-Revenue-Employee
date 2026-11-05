import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeSource } from '@prisma/client';
import type { EmbeddedChunk } from '../context/types.js';
process.env.DATABASE_URL = ''; process.env.GEMINI_API_KEY = ''; process.env.OPENAI_API_KEY = '';
const { composeSourceDocuments } = await import('./sourceComposition.js');
const { sourceChunks, validateSourceUrl, validateUpload } = await import('./sources.service.js');
const { buildSourceVersion } = await import('./sources.worker.js');
const { selectRetrieval, findSourceConflicts } = await import('../context/retrievalSelection.js');
const { planRetrieval } = await import('../context/retrievalPlan.js');
const { crawl } = await import('../crawler/crawler.js');
const { config } = await import('../config/index.js');
const origin = 'https://fixture.test';
const doc = (id = 'base', content = 'Dental cleaning starts at ₹999.'): EmbeddedChunk => ({
  id, content, embedding: [1, 0], hash: id, heading: 'Dental cleaning', title: 'Pricing', url: `${origin}/pricing`,
  page: '/pricing', pageType: 'pricing', section: 'dental-cleaning', language: 'English', lastCrawled: '2026-11-01T00:00:00Z',
});
const row = (overrides: Partial<KnowledgeSource> = {}): KnowledgeSource => ({ id: 'source', organizationId: 'org', websiteId: 'site',
  origin, key: 'page', kind: 'PAGE', url: `${origin}/pricing`, title: 'Dental cleaning', enabled: true, priority: 0,
  status: 'READY', content: '', contentHash: '', chunks: [], embeddingModel: config.gemini.embeddingModel,
  pendingContent: null, pendingFile: null, fileName: null, error: null, revision: 0, leaseToken: null, leaseExpiresAt: null,
  checkedAt: new Date('2026-11-05'), publishedAt: new Date('2026-11-05'), nextCheckAt: new Date(), createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
  ...overrides });

test('source disabling and removal exclude primary and alias provenance without mutating the base snapshot', () => {
  const base = doc(); base.sourceAliases = [{ url: `${origin}/faq`, title: 'FAQ', heading: 'Dental cleaning' }];
  const original = structuredClone(base);
  let result = composeSourceDocuments([base], [row({ enabled: false })], origin, config.gemini.embeddingModel);
  assert.equal(result[0].url, `${origin}/faq`);
  result = composeSourceDocuments([base], [row({ deletedAt: new Date() }), row({ id: 'alias', url: `${origin}/faq`, enabled: false })], origin, config.gemini.embeddingModel);
  assert.equal(result.length, 0); assert.deepEqual(base, original);
});
test('one-page update replaces its old chunks, preserves other pages and survives queued or failed updates', () => {
  const old = doc(), other = { ...doc('about', 'Our business opens Monday.'), url: `${origin}/about` };
  const replacement = { ...doc('new', 'Dental cleaning starts at ₹1,499.'), lastCrawled: '2026-11-05T00:00:00Z' };
  for (const status of ['READY', 'QUEUED', 'FAILED']) {
    const result = composeSourceDocuments([old, other], [row({ chunks: [replacement] as never, status })], origin, config.gemini.embeddingModel);
    assert.deepEqual(result.map(chunk => chunk.id), ['about', 'new']);
  }
});
test('a later full crawl supersedes an old page overlay while retaining priority and custom uploads', () => {
  const newer = { ...doc('full-new'), lastCrawled: '2026-11-06T00:00:00Z' };
  const result = composeSourceDocuments([newer], [row({ priority: 50, chunks: [doc('old-overlay')] as never }),
    row({ id: 'note', kind: 'TEXT', url: null, chunks: [{ ...doc('note'), url: `${origin}/__knowledge/source/note` }] as never })], origin, config.gemini.embeddingModel);
  assert.deepEqual(result.map(chunk => chunk.id), ['full-new', 'note']); assert.equal(result[0].sourcePriority, 50);
});
test('incompatible or foreign overlays cannot hide or contaminate a valid website index', () => {
  const result = composeSourceDocuments([doc()], [row({ embeddingModel: 'different', chunks: [doc('incompatible')] as never }),
    row({ id: 'foreign', origin: 'https://foreign.test', chunks: [doc('foreign')] as never })], origin, config.gemini.embeddingModel);
  assert.deepEqual(result.map(chunk => chunk.id), ['base']);
});
test('explicit priority resolves a matching price conflict; equal priority remains flagged', () => {
  const old = { ...doc(), score: .9 }, preferred = { ...doc('new', 'Dental cleaning starts at ₹1,499.'), url: `${origin}/__knowledge/source/new`, score: .9, sourcePriority: 50 };
  const plan = planRetrieval('Dental cleaning price?', [old, preferred]);
  const options = { topK: 5, threshold: .4, maxChars: 12000, sourceUrl: origin };
  const result = selectRetrieval([old, preferred], plan, options);
  assert.deepEqual(result.chunks.map(chunk => chunk.id), ['new']); assert.equal(result.diagnostics.conflicts.length, 0);
  const equal = { ...preferred, sourcePriority: 0 };
  assert.ok(selectRetrieval([old, equal], plan, options).diagnostics.conflicts.length);
  assert.ok(findSourceConflicts([old, preferred], plan).length);
});
test('single-page crawl respects robots, skips sitemap discovery and never fetches linked pages', async () => {
  const calls: string[] = [];
  const result = await crawl(`${origin}/pricing`, { singlePage: true, maxPages: 1 }, { sleep: async () => {}, fetch: async url => {
    const path = new URL(url).pathname; calls.push(path);
    return { url, status: path === '/robots.txt' ? 404 : 200, headers: { 'content-type': 'text/html' },
      body: Buffer.from('<main><h1>Dental cleaning</h1><p>Dental cleaning starts at ₹999.</p><a href="/other">Other page</a></main>') };
  } });
  assert.deepEqual(calls, ['/robots.txt', '/pricing']); assert.equal(result.pages.length, 1); assert.equal(result.manifest.completeWithinScope, true);
});
test('uploaded text preserves short facts and rejects oversized units without silently truncating', () => {
  const source = row({ kind: 'TEXT', url: null });
  assert.equal(sourceChunks('Refunds require 7 days notice.', source, 'English')[0].content, 'Refunds require 7 days notice.');
  assert.throws(() => sourceChunks('x'.repeat(8001), source, 'English'), /Split it into paragraphs/);
  assert.throws(() => sourceChunks('', source, 'English'), /readable text/);
});
test('URL and upload validation reject cross-origin, credential-bearing and disguised files', () => {
  assert.equal(validateSourceUrl(`${origin}/pricing?utm_source=test#section`, origin), `${origin}/pricing`);
  for (const url of ['http://localhost/private', 'https://other.test/pricing', `${origin}/pricing?token=secret`, `${origin}/file.pdf`])
    assert.throws(() => validateSourceUrl(url, origin));
  assert.throws(() => validateUpload('file.exe', 'aGVsbG8='));
  assert.throws(() => validateUpload('file.pdf', 'aGVsbG8='), /valid PDF/);
  assert.equal(validateUpload('facts.txt', Buffer.from('Our office opens Monday.').toString('base64')).toString(), 'Our office opens Monday.');
});
test('unchanged custom content reuses embeddings; provider failure leaves the input version untouched', async () => {
  const source = row({ kind: 'TEXT', url: null, pendingContent: 'Dental cleaning starts at ₹1,499.' });
  const result = await buildSourceVersion(source, 'English', new AbortController().signal, { embed: async chunks => chunks.map(chunk => ({ ...chunk, embedding: [1, 0] })) });
  const published = { ...source, content: result.content, pendingContent: null, chunks: result.chunks as never };
  const repeated = await buildSourceVersion(published, 'English', new AbortController().signal, { embed: async chunks => { assert.equal(chunks.length, 0); return []; } });
  assert.equal(repeated.embeddingsReused, result.chunks.length);
  const original = structuredClone(published);
  await assert.rejects(buildSourceVersion({ ...published, pendingContent: 'Dental cleaning starts at ₹2,000.' }, 'English', new AbortController().signal, { embed: async () => { throw Error('provider offline'); } }));
  assert.deepEqual(published, original);
});
test('incomplete embedding output never becomes a publishable source version', async () => {
  await assert.rejects(buildSourceVersion(row({ kind: 'TEXT', pendingContent: 'Dental cleaning starts at ₹1,499.' }), 'English', new AbortController().signal,
    { embed: async () => [] }), /did not complete/);
});
