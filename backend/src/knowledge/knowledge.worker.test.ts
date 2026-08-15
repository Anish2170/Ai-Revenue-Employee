import assert from 'node:assert/strict';
import test from 'node:test';
import { knowledgeBuildErrorCode, knowledgeBuildRetryDelay } from './knowledge.worker.js';

test('knowledge worker classifies permanent build failures without retry', () => {
  assert.equal(knowledgeBuildErrorCode(new Error('Crawl found no readable pages at https://example.test')), 'PERMANENT_BUILD_ERROR');
  assert.equal(knowledgeBuildErrorCode(new Error('unsafe website URL')), 'PERMANENT_BUILD_ERROR');
});

test('knowledge worker classifies transient failures and bounds retry backoff', () => {
  assert.equal(knowledgeBuildErrorCode(new Error('temporary Gemini API timeout')), 'TRANSIENT_BUILD_ERROR');
  const first = knowledgeBuildRetryDelay(1);
  const later = knowledgeBuildRetryDelay(20);
  assert.ok(first >= 1000 && first < 1500);
  assert.ok(later >= 60000 && later < 60500);
});
