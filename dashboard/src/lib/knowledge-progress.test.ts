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
test('partial refresh is not shown as complete website knowledge',()=>{
  const view=describeBuildProgress({status:'FAILED',phase:'partial',coverage:{completeWithinScope:false,discovered:20,attempted:10,failed:2}});
  assert.ok(view.percent<100);assert.match(view.title,/incomplete/i);assert.match(view.description,/previous/i);
});
test('published progress explicitly describes crawl scope rather than entire website completeness',()=>{
  const view=describeBuildProgress({status:'SUCCESS',phase:'complete',coverage:{completeWithinScope:true,discovered:10,attempted:8,failed:0}});
  assert.equal(view.percent,100);assert.match(view.description,/scope|entire website/i);
});

test('approved limited publication keeps missing-source warnings and describes build completion', () => {
  const view = describeBuildProgress({ status: 'SUCCESS', coverage: { completeWithinScope: false }, configuration: { approval: { inventory: [
    { url: '/pricing', disposition: 'required' }, { url: '/blog/old', disposition: 'owner_excluded' },
  ] } } });
  assert.equal(view.percent, 100); assert.equal(view.title, 'Approved scope ready');
  assert.match(view.description, /1 required included/); assert.match(view.description, /1 optional pages/); assert.match(view.description, /not whole-website/);
});

test('approved configuration cannot turn a failed required-source build into success', () => {
  const view = describeBuildProgress({ status: 'FAILED', phase: 'partial', coverage: { completeWithinScope: false }, configuration: { approval: { inventory: [] } } });
  assert.ok(view.percent < 100); assert.match(view.description, /retained/);
});
