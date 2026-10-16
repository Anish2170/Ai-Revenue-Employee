import assert from 'node:assert/strict';
import test from 'node:test';
import { describeBuildProgress } from './knowledge-progress.ts';

test('action progress advances within a stage and reserves 100% for published success', () => {
  const start = describeBuildProgress({ status: 'RUNNING', phase: 'action_discovery', progress: { actionsTotal: 100, actionsCompleted: 0 } });
  const middle = describeBuildProgress({ status: 'RUNNING', phase: 'action_discovery', progress: { actionsTotal: 100, actionsCompleted: 50 } });
  assert.ok(middle.percent > start.percent);
  assert.match(middle.description, /50 of 100/);
  assert.equal(describeBuildProgress({ status: 'RUNNING', phase: 'saving' }).percent, 98);
  assert.equal(describeBuildProgress({ status: 'SUCCESS', phase: 'complete' }).percent, 100);
  for (const status of ['QUEUED', 'RETRY_WAIT', 'FAILED', 'CANCELLED']) {
    assert.ok(describeBuildProgress({ status, phase: 'complete' }).percent < 100);
  }
});

test('unknown totals and older build records never produce invalid percentages', () => {
  for (const phase of ['queued', 'starting', 'crawling', 'action_discovery', 'chunking', 'embedding', 'indexing', 'saving']) {
    const view = describeBuildProgress({ status: 'RUNNING', phase, progress: { actionsTotal: 0, crawlLimit: 0 } });
    assert.ok(Number.isFinite(view.percent));
    assert.ok(view.percent >= 0 && view.percent < 100);
  }
});
