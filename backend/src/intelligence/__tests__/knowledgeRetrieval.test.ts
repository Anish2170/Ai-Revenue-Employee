/** Tests for Sprint 4.2 component 2: strategy-aware knowledge retrieval. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { perceive } from '../perceive.js';
import { buildConversationStrategy } from '../conversationStrategy.js';
import { buildStrategyKnowledgeQuery, retrieveStrategyKnowledge } from '../knowledgeRetrieval.js';
import { SCENARIOS } from './fixtures.js';
import type { RetrievedChunk } from '../../context/types.js';

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
        chunk({ id: 'b', content: 'Second chunk should not fit after the first clipped chunk.' }),
      ],
      scores: [0.9, 0.8],
    }),
  });

  assert.equal(result.knowledgeAvailable, true);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].content.length <= 30, true);
  assert.equal(result.chunks[0].score, 0.9);
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