import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActionGraph, extractActionsFromHtml, selectActionDiscoveryCandidates } from './actionDiscovery.js';
import { crawl } from '../crawler/crawler.js';
import { ingest } from '../services/ingestService.js';
import { buildChunks } from '../chunking/chunker.js';
import { config } from '../config/index.js';
import { snapshotSha256 } from '../vectorstore/snapshotStorage.js';
import type { KnowledgeSnapshot } from '../context/types.js';

const origin = 'https://rebuild-fixture.test';
const expected = {
  pricing: '/pricing', contact: '/contact', signup: '/join',
  book_demo: '/book-assessment', free_trial: '/claim-free-session',
};
const navigation = Array.from({ length: 17 }, (_, i) => `<a href="/program-${i}">Program ${i}</a>`).join('')
  + '<a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/join">Join Now</a>';
const homepage = `<html><head><title>Example Fitness</title></head><body>
  <nav id="desktop">${navigation}</nav><nav id="mobile">${navigation}</nav>
  <main><h1>Fitness membership</h1><p>Membership costs $20 per month. Training sessions are available Monday to Friday.</p>
  <a href="/book-assessment">Book Fitness Assessment</a><a href="/claim-free-session">Claim Free Session</a></main></body></html>`;
const source = () => crawl(origin, { maxPages: 30, maxRenderedPages: 0 }, {
  sleep: async () => {},
  // Every request stays inside this fixture; no network/browser transport.
  fetch: async url => {
    const path = new URL(url).pathname;
    const missing = path === '/robots.txt' || /sitemap/.test(path);
    return { url, status: missing ? 404 : 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(missing ? '' : path === '/' ? homepage
      : `<html><head><title>Example Fitness ${path}</title></head><body><main><h1>Information ${path}</h1><p>Training at ${path} costs $20 per month and is available Monday to Friday.</p></main></body></html>`) };
  },
});
const destinations = (snapshot: Pick<KnowledgeSnapshot, 'actionGraph'>) => Object.fromEntries(
  snapshot.actionGraph!.nodes.map(node => [node.intent, new URL(node.preferred.url).pathname]),
);

test('normal crawler retains late business CTAs after repeated desktop/mobile navigation', async () => {
  const result = await source();
  assert.equal(result.manifest.completeWithinScope, true);
  const home = result.pages.find(page => page.path === '/')!;
  const raw = extractActionsFromHtml(homepage, home, 100);
  const old = await buildActionGraph(raw.slice(0, 20), { rulesOnly: true });
  assert.equal(old.nodes.some(node => node.intent === 'book_demo' || node.intent === 'free_trial'), false);
  const selected = result.actions.filter(action => action.pagePath === '/');
  assert.ok(selected.length <= 20);
  assert.deepEqual(destinations({ actionGraph: await buildActionGraph(selected, { rulesOnly: true }) }), expected);
});

test('normal rebuild writes all intents despite site-wide duplicate navigation and unchanged knowledge', async () => {
  const result = await source();
  const pricing = result.actions.find(action => action.url === origin + '/pricing')!;
  const lateActions = result.actions.filter(action => action.url !== pricing.url);
  result.actions = [...Array.from({ length: 110 }, () => pricing), ...lateActions];
  const previous: KnowledgeSnapshot = {
    version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 2,
    sourceUrl: origin, createdAt: '2026-11-01T00:00:00Z', siteLinks: [],
    pages: result.pages.map(({ url, path, pageType, contentHash, lastCrawled }) => ({ url, path, pageType, contentHash, lastCrawled })),
    documents: buildChunks(result.pages, 'English').chunks.map(chunk => ({ ...chunk, embedding: [1, 0] })),
    actionGraph: await buildActionGraph([pricing], { rulesOnly: true }),
  };
  let written: KnowledgeSnapshot | undefined;
  const rebuilt = await ingest(origin, { websiteId: 'fixture-site', organizationId: 'fixture-org', snapshotId: 'new-version', language: 'English' }, {
    crawl: async () => result,
    previous: async () => previous,
    embed: async chunks => { assert.equal(chunks.length, 0); return []; },
    actions: async (raw, options) => {
      assert.ok(raw.length <= 100);
      return buildActionGraph(raw, { ...options, rulesOnly: true, generate: async () => { throw Error('AI forbidden'); } });
    },
    write: async snapshot => {
      const bytes = Buffer.from(JSON.stringify(snapshot));
      written = JSON.parse(bytes.toString()) as KnowledgeSnapshot;
      return { provider: 'LOCAL', storageKey: 'in-memory-new-version', contentBytes: bytes.length, contentSha256: snapshotSha256(bytes), etag: null };
    },
  });
  assert.deepEqual(destinations(written!), expected);
  assert.equal(written!.publication!.id, 'new-version');
  assert.equal(rebuilt.embeddingsCreated, 0);
  assert.equal(rebuilt.embeddingsReused, previous.documents.length);
  assert.deepEqual(previous.actionGraph!.nodes.map(node => node.intent), ['pricing']);
  assert.deepEqual(written!.documents, previous.documents);
});

test('bounded selection preserves alternative destinations and unclassified controls for existing fallback', async () => {
  const result = await source();
  const pricing = result.actions.find(action => action.url === origin + '/pricing')!;
  const contact = result.actions.find(action => action.url === origin + '/contact')!;
  const unknown = { ...pricing, label: 'Explore more', url: origin + '/explore' };
  const alternative = { ...pricing, url: origin + '/pricing?plan=annual' };
  const raw = [...Array.from({ length: 30 }, () => pricing), alternative, contact, unknown];
  const selected = selectActionDiscoveryCandidates(raw, 4);
  assert.equal(selected.length, 4);
  assert.ok(selected.includes(contact));
  assert.ok(selected.includes(alternative));
  assert.ok(selected.includes(unknown));
  assert.deepEqual(selectActionDiscoveryCandidates(raw, 4), selected);
  assert.deepEqual(selectActionDiscoveryCandidates(raw, 0), []);
  assert.deepEqual(selectActionDiscoveryCandidates([unknown], 20), [unknown]);
  const otherContext = { ...unknown, context: 'A different business offer' };
  assert.deepEqual(selectActionDiscoveryCandidates([...Array.from({ length: 30 }, () => pricing), unknown, otherContext], 3), [pricing, unknown, otherContext]);
});
