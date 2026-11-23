import assert from 'node:assert/strict';
import test from 'node:test';
import type { StrategyKnowledgeResult } from '../intelligence/knowledgeRetrieval.js';
import { replayKnowledgeTrace } from './knowledgeTrace.js';

const result: StrategyKnowledgeResult = {
  query: 'pricing options Page topic: pricing',
  unavailableReason: 'conflicting_knowledge',
  knowledgeAvailable: false,
  chunks: [],
  scores: [],
  diagnostics: {
    mode: 'semantic', originalQuery: 'pricing options', searchQuery: 'pricing options',
    pageUrl: 'https://example.test/pricing', candidateCount: 3, topicSource: 'page',
    subjects: [], ambiguous: false, coverage: [{ need: 'price', status: 'candidate', sourceIds: ['/pricing#1'] }],
    conflicts: [{ kind: 'price', subject: 'Custom plan', sourceIds: ['/pricing#1', '/pricing?select=trial#2'], urls: [] }],
    duplicates: [], ranking: [{ id: '/pricing#1', cosine: 0.74, rankScore: 1, reasons: ['indexed_page_match'] }],
    omitted: [{ id: '/other#1', reason: 'below_cosine_threshold' }],
  },
};

test('reports why the popup could not use selected pricing results', () => {
  const trace = replayKnowledgeTrace(result, '/pricing');
  assert.equal(trace.query, result.query);
  assert.equal(trace.unavailableReason, 'conflicting_knowledge');
  assert.deepEqual(trace.conflicts, [{ kind: 'price', sourceIds: ['/pricing#1', '/pricing#2'] }]);
  assert.equal(trace.selectedBySearch?.[0]?.id, '/pricing#1');
  assert.deepEqual(trace.keptForPopup, []);
  assert.deepEqual(trace.omissionReasons, [{ reason: 'below_cosine_threshold', count: 1, examples: ['/other#1'] }]);
});

test('does not copy knowledge content or URL parameter values into the replay export', () => {
  const knowledge = { ...result, query: 'Page topic: pricing private-value', chunks: [{ id: '/pricing#1', url: 'https://example.test/pricing', page: '/pricing', pageType: 'pricing' as const, heading: 'Fees', content: 'private content', score: 0.74 }] };
  const trace = replayKnowledgeTrace(knowledge, '/pricing?visitor=private-value');
  assert.equal(trace.page, '/pricing');
  assert.equal(trace.query, null);
  assert.equal(trace.searchQuery, null);
  assert.ok(!JSON.stringify(trace).includes('private'));
  assert.deepEqual(trace.keptForPopup, [{ id: '/pricing#1', score: 0.74, characters: 15 }]);
});
