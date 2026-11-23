import assert from 'node:assert/strict';
import test from 'node:test';
import { replaySummary, type ReplayRun } from './popup-replay.ts';
const run = (id: string, status: string, body = 'Question about legal services?') => ({ id, status, result: { popup: { type: 'pricing', body } } }) as ReplayRun;
test('controlled distribution counts actual displays, silent outcomes and repeated bodies separately', () => {
  const result = replaySummary([run('a', 'DISPLAYED'), run('b', 'DISPLAYED'), run('c', 'SUPPRESSED'), run('d', 'FAILED'), run('e', 'UNEXPECTED_POPUP', 'A different question')]);
  assert.deepEqual(result, { displayed: 2, suppressed: 1, failed: 2, types: { pricing: 3 }, repeatedCopies: 1 });
});
test('queued/generated-only results cannot inflate displayed popup distribution', () => {
  assert.deepEqual(replaySummary([run('a', 'QUEUED'), run('b', 'RUNNING')]).types, {});
});
