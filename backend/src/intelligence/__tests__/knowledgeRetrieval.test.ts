/** Tests for Sprint 4.2 component 2: strategy-aware knowledge retrieval. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { perceive } from '../perceive.js';
import { buildConversationStrategy } from '../conversationStrategy.js';
import { buildStrategyKnowledgeQuery, retrieveStrategyKnowledge } from '../knowledgeRetrieval.js';
import { SCENARIOS } from './fixtures.js';
import type { RetrievedChunk } from '../../context/types.js';
import { planRetrieval } from '../../context/retrievalPlan.js';
import { selectRetrieval } from '../../context/retrievalSelection.js';

function priceStrategy() {
  const scenario = SCENARIOS.find((s) => s.name === 'price-wall');
  if (!scenario) throw new Error('missing price-wall scenario');
  const decision = perceive({
    events: scenario.events,
    now: scenario.now,
    context: scenario.context,
    objective: scenario.objective,
    surface: scenario.surface,
  });
  const strategy = buildConversationStrategy({ decision, objective: scenario.objective });
  if (!strategy) throw new Error('expected strategy');
  return strategy;
}

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: overrides.id ?? 'chunk-1',
    page: overrides.page ?? '/pricing',
    url: overrides.url ?? 'https://example.test/pricing',
    pageType: overrides.pageType ?? 'pricing',
    section: overrides.section ?? 'pricing',
    heading: overrides.heading ?? 'Pricing',
    title: overrides.title ?? 'Pricing',
    language: overrides.language ?? 'English',
    hash: overrides.hash ?? 'hash',
    lastCrawled: overrides.lastCrawled ?? '2026-07-04T00:00:00.000Z',
    content: overrides.content ?? 'Pricing plans are customized by use case. Book a demo to discuss value.',
    score: overrides.score ?? 0.82,
  };
}

test('knowledgeRetrieval: query is built from strategy and safe summaries', () => {
  const strategy = priceStrategy();
  const query = buildStrategyKnowledgeQuery(strategy);

  assert.match(query, /ReducePriceAnxiety/);
  assert.match(query, /PriceSensitive/);
  assert.match(query, /EvaluatePrice/);
  assert.match(query, /pricing/);
  assert.equal(query.includes('content_dwell'), false);
  assert.equal(query.includes('pricing_focus'), false);
});

test('pricing page browsing retrieves published fees without mistaking strategy keywords for an offering', async () => {
  const sourceUrl = 'https://example.test';
  const context = { pagePath: '/pricing', sourceUrl };
  const documents = [
    chunk({ id: 'package', heading: 'Formation & Setup', content: 'Formation & Setup\nStartup Catalyst\nEssential corporate formation.\n$2,500\n/ flat fee\nDelaware C-Corp filing' }),
    chunk({ id: 'faq', heading: 'Value', page: '/about', url: `${sourceUrl}/about`, pageType: 'about', content: 'We value long-term relationships.' }),
  ];
  const search = (query: string) => selectRetrieval(documents, planRetrieval(query, documents, {
    purpose: 'popup', page: { path: context.pagePath }, sourceUrl,
  }), { topK: 5, threshold: 0.6, maxChars: 9000, sourceUrl });
  const legacyQuery = 'collect_lead ReducePriceAnxiety discuss_pricing PriceSensitive EvaluatePrice warm high pricing plans cost value faq Page topic: pricing';
  assert.deepEqual(search(legacyQuery).chunks, []);

  const result = await retrieveStrategyKnowledge(priceStrategy(), { ...context, retrieveFn: async query => search(query) });
  assert.equal(result.unavailableReason, null);
  assert.deepEqual(result.chunks.map(row => row.id), ['package']);
  assert.match(result.chunks[0].content, /\$2,500\n\/ flat fee/);
});

test('a pricing page popup still stops when its sources disagree on the price', async () => {
  const sourceUrl = 'https://example.test';
  const documents = [
    chunk({ id: 'published', heading: 'Startup Catalyst', content: 'Startup Catalyst costs $2,500.' }),
    chunk({ id: 'conflicting', heading: 'Startup Catalyst', content: 'Startup Catalyst costs $3,500.' }),
  ];

  const result = await retrieveStrategyKnowledge(priceStrategy(), {
    pagePath: '/pricing', sourceUrl,
    retrieveFn: async query => selectRetrieval(documents, planRetrieval(query, documents, {
      purpose: 'popup', page: { path: '/pricing' }, sourceUrl,
    }), { topK: 5, threshold: 0.6, maxChars: 9000, sourceUrl }),
  });

  assert.equal(result.unavailableReason, 'conflicting_knowledge');
  assert.deepEqual(result.chunks, []);
  assert.match(buildStrategyKnowledgeQuery(priceStrategy(), { pagePath: '/pricing?select=gc', sourceUrl }), /ReducePriceAnxiety/);
});

test('knowledgeRetrieval: forwards query and website id to existing RAG boundary', async () => {
  const strategy = priceStrategy();
  let seenQuery = '';
  let seenWebsite: string | undefined;

  const result = await retrieveStrategyKnowledge(strategy, {
    websiteId: 'website-123',
    retrieveFn: async (query, websiteId) => {
      seenQuery = query;
      seenWebsite = websiteId;
      return { chunks: [chunk()], scores: [0.82] };
    },
  });

  assert.equal(seenWebsite, 'website-123');
  assert.equal(seenQuery, result.query);
  assert.equal(result.knowledgeAvailable, true);
  assert.equal(result.unavailableReason, null);
  assert.equal(result.chunks.length, 1);
});

test('knowledgeRetrieval: keeps only minimal relevant knowledge', async () => {
  const strategy = priceStrategy();
  const result = await retrieveStrategyKnowledge(strategy, {
    maxChunks: 2,
    maxChars: 30,
    retrieveFn: async () => ({
      chunks: [
        chunk({ id: 'a', score: 0.9, content: 'First chunk has a lot of pricing details for the prompt.' }),
        chunk({ id: 'b',score:0.8,content: 'A complete short source.' }),
      ],
      scores: [0.9, 0.8],
    }),
  });

  assert.equal(result.knowledgeAvailable, true);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].content.length <= 30, true);
  assert.equal(result.chunks[0].id, 'b');
  assert.equal(result.chunks[0].score, 0.8);
  assert.equal(result.chunks[0].truncated, false);
});

test('knowledgeRetrieval: reports missing knowledge without throwing', async () => {
  const strategy = priceStrategy();
  const result = await retrieveStrategyKnowledge(strategy, {
    retrieveFn: async () => ({ chunks: [], scores: [] }),
  });

  assert.equal(result.knowledgeAvailable, false);
  assert.deepEqual(result.chunks, []);
  assert.equal(result.unavailableReason, 'no_relevant_knowledge');
});

test('knowledgeRetrieval: retains a whole legacy pricing page above 1800 characters', async () => {
  // The retained Dental /pricing source is 2079 characters. It must remain
  // whole; a prefix could lose price qualifiers or turn examples into claims.
  const content = 'Pricing details and their full conditions. '.repeat(51).slice(0, 2079);
  assert.equal(content.length, 2079);
  const result = await retrieveStrategyKnowledge(priceStrategy(), {
    retrieveFn: async () => ({ chunks: [chunk({ content })], scores: [0.82] }),
  });
  assert.equal(result.knowledgeAvailable, true);
  assert.equal(result.chunks[0]?.content, content);
  assert.equal(result.chunks[0]?.truncated, false);
});

test('knowledgeRetrieval: explains when whole sources cannot fit the budget', async () => {
  const result = await retrieveStrategyKnowledge(priceStrategy(), {
    maxChars: 1800,
    retrieveFn: async () => ({ chunks: [chunk({ content: 'x'.repeat(2079) })], scores: [0.82] }),
  });
  assert.equal(result.knowledgeAvailable, false);
  assert.equal(result.unavailableReason, 'no_knowledge_within_budget');
});

test('knowledgeRetrieval: output contains no raw event names', async () => {
  const strategy = priceStrategy();
  const result = await retrieveStrategyKnowledge(strategy, {
    retrieveFn: async () => ({ chunks: [chunk()], scores: [0.82] }),
  });

  const encoded = JSON.stringify(result);
  assert.equal(encoded.includes('content_dwell'), false);
  assert.equal(encoded.includes('zone_revisit'), false);
  assert.equal(encoded.includes('pricing_focus'), false);
});
