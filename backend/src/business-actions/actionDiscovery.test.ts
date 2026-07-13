import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActionGraph, extractActionsFromHtml } from './actionDiscovery.js';
import type { CrawledPage } from '../context/types.js';

function page(path = '/'): CrawledPage {
  return {
    url: `https://example.test${path}`,
    path,
    title: path === '/' ? 'Home' : path,
    text: 'Example page content with enough words for crawler acceptance.',
    pageType: path === '/' ? 'home' : 'other',
    contentHash: 'hash',
    lastCrawled: new Date('2026-07-11T00:00:00.000Z').toISOString(),
  };
}

test('action discovery maps varied demo labels to book_demo without inventing URLs', async () => {
  const html = `
    <header><nav><a href="/sales">Talk to Sales</a></nav></header>
    <main>
      <section class="hero"><h1>Enterprise automation</h1><a class="btn primary" href="/demo">Book Demo</a></section>
      <section><h2>For teams</h2><a href="/schedule-call">Schedule Call</a></section>
      <section><h2>Experts</h2><a href="/expert">Meet an Expert</a></section>
      <section><h2>Advisory</h2><a href="/consultation">Request Consultation</a></section>
    </main>
  `;

  const raw = extractActionsFromHtml(html, page('/'));
  const graph = await buildActionGraph(raw);
  const demo = graph.nodes.find((node) => node.intent === 'book_demo');

  assert.ok(demo);
  assert.equal(demo.preferred.url, 'https://example.test/demo');
  assert.deepEqual(
    demo.candidates.map((candidate) => candidate.url).sort(),
    [
      'https://example.test/consultation',
      'https://example.test/demo',
      'https://example.test/expert',
      'https://example.test/sales',
      'https://example.test/schedule-call',
    ].sort(),
  );
});

test('action discovery classifies pricing, support, trial, auth, and docs intents', async () => {
  const html = `
    <a href="/plans">Compare Plans</a>
    <a href="/help">Help Center</a>
    <a href="/trial">Start Free Trial</a>
    <a href="/login">Sign In</a>
    <a href="/signup">Create Account</a>
    <a href="/api">API Docs</a>
  `;

  const graph = await buildActionGraph(extractActionsFromHtml(html, page('/')));
  const intents = graph.nodes.map((node) => node.intent).sort();

  assert.deepEqual(intents, ['documentation', 'free_trial', 'login', 'pricing', 'signup', 'support'].sort());
});

test('action discovery ignores normal UI controls and cookie/search chrome', async () => {
  const html = `
    <button>Search</button>
    <button>Toggle theme</button>
    <button>Accept cookies</button>
    <button>Next</button>
    <a href="#pricing">Pricing section</a>
    <nav><a href="/pricing">Pricing</a></nav>
    <main><a href="/demo">Request Demo</a></main>
  `;

  const raw = extractActionsFromHtml(html, page('/'));
  const graph = await buildActionGraph(raw);

  assert.deepEqual(graph.nodes.map((node) => node.intent).sort(), ['book_demo', 'pricing']);
  assert.equal(graph.nodes.reduce((sum, node) => sum + node.candidates.length, 0), 2);
});


test('action discovery prefers explicit demo destinations over generic contact pages', async () => {
  const html = `
    <header><nav><a href="/contact">Contact</a><a href="/request-demo">Request Demo</a></nav></header>
    <main>
      <section class="hero"><h1>Revenue automation</h1><a class="btn primary" href="/book-demo">Book Demo</a></section>
      <section><a href="/schedule-demo">Schedule Demo</a></section>
      <section><a href="/contact">Contact Sales</a></section>
      <footer><a href="/contact">Contact</a></footer>
    </main>
  `;

  const graph = await buildActionGraph(extractActionsFromHtml(html, page('/')));
  const demo = graph.nodes.find((node) => node.intent === 'book_demo');

  assert.ok(demo);
  assert.equal(demo.preferred.url, 'https://example.test/book-demo');
  assert.notEqual(demo.preferred.url, 'https://example.test/contact');
});

test('action discovery ignores documentation search, theme, filter, pagination, share, and language controls', async () => {
  const html = `
    <main>
      <h1>Documentation</h1>
      <button aria-label="Search documentation" class="search-trigger">Search</button>
      <button aria-label="Toggle theme" data-action="theme-toggle">Toggle Theme</button>
      <button class="dark-mode-toggle">Dark mode</button>
      <button class="filter-control">Filter</button>
      <nav class="pagination"><a href="/docs/page-2">Next</a><a href="/docs/page-0">Previous</a></nav>
      <button class="share-button">Share</button>
      <a class="social-link" href="https://twitter.com/example">Twitter</a>
      <button class="language-switcher">English</button>
      <a href="/docs/api">API Docs</a>
    </main>
  `;

  const graph = await buildActionGraph(extractActionsFromHtml(html, page('/docs')));
  const labels = graph.nodes.flatMap((node) => node.candidates.map((candidate) => candidate.label.toLowerCase()));

  assert.ok(graph.nodes.some((node) => node.intent === 'documentation'));
  assert.ok(!labels.some((label) => /search|theme|dark mode|filter|next|previous|share|english/.test(label)));
});
test('action graph merges duplicate CTAs and keeps raw candidates for debug', async () => {
  const html = `
    <header><a href="/request-demo">Request Demo</a></header>
    <section class="hero"><a class="btn primary" href="/request-demo">Request Demo</a></section>
    <section><a href="/request-demo?utm=pricing">Request Demo</a></section>
    <footer><a href="/request-demo">Request Demo</a></footer>
  `;

  const graph = await buildActionGraph(extractActionsFromHtml(html, page('/')));
  const demo = graph.nodes.find((node) => node.intent === 'book_demo');

  assert.ok(demo);
  assert.equal(demo.candidates.length, 1);
  assert.equal(demo.preferred.url, 'https://example.test/request-demo');
  assert.equal(demo.preferred.rankSignals.occurrenceCount, 4);
  assert.equal(demo.rawCandidates?.length, 4);
});

