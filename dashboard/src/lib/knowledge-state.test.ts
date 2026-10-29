import test from 'node:test';
import assert from 'node:assert/strict';
import { KnowledgeState, type KnowledgeClient } from './knowledge-state.ts';
const previous = { id: 'old', status: 'SUCCESS', configuration: { budget: { maxPages: 50, maxRenderedPages: 5 } } };
function fixture() {
  const timers = new Map<number, () => void>(); let next = 0;
  let build = { ...previous };
  const snapshot = { id: 'published-good' };
  const client: KnowledgeClient = {
    async getKnowledgeStatus() { return { hasKnowledge: true, snapshot, lastBuild: build }; },
    async getKnowledgeBuild() { return build; },
    async queueKnowledgeBuild() { build = { ...previous, id: 'new', status: 'RUNNING' }; return { buildId: 'new', status: 'QUEUED' }; },
    async cancelKnowledgeBuild() { build = { ...build, status: 'CANCELLED' }; return { cancelled: true }; },
  };
  const state = new KnowledgeState(client, 'site', () => {}, fn => { timers.set(++next, fn); return next as unknown as ReturnType<typeof setTimeout>; }, id => { timers.delete(Number(id)); });
  return { state, client, timers, setBuild: (value: typeof build) => { build = value; }, snapshot };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
test('refresh replaces old SUCCESS immediately and exposes the cancellable new job', async () => {
  const f = fixture(); await f.state.refresh();
  const pending = f.state.start('https://fixture.invalid');
  assert.equal(JSON.stringify(f.state.value.status?.lastBuild), 'null');
  assert.equal(f.state.value.pending, true);
  await pending;
  assert.equal(f.state.value.status?.lastBuild.id, 'new');
  assert.equal(f.state.value.status?.lastBuild.status, 'RUNNING');
  assert.equal(f.state.value.status?.snapshot, f.snapshot);
  assert.equal(f.timers.size, 1);
});
test('cancel updates the same job without reload and stops active polling', async () => {
  const f = fixture(); await f.state.refresh(); await f.state.start('https://fixture.invalid'); await f.state.cancel();
  assert.equal(f.state.value.status?.lastBuild.status, 'CANCELLED');
  assert.equal(f.state.value.status?.snapshot.id, 'published-good');
  assert.equal(f.timers.size, 0); assert.equal(f.state.value.cancelling, false);
});
test('publication winning cancellation shows SUCCESS instead of inventing CANCELLED', async () => {
  const f = fixture(); await f.state.refresh(); await f.state.start('https://fixture.invalid');
  f.client.cancelKnowledgeBuild = async () => { f.setBuild({ ...previous, id: 'new' }); return { cancelled: false }; };
  await f.state.cancel(); assert.equal(f.state.value.status?.lastBuild.status, 'SUCCESS'); assert.equal(f.timers.size, 0);
});
test('verified success clears prior transport errors', async () => {
  const f = fixture(); await f.state.refresh(); f.state.value.error = 'Old failure';
  await f.state.refresh(); assert.equal(f.state.value.error, '');
});
test('persisted budget restored on initial navigation; explicit edit survives refresh', async () => {
  const f = fixture(); await f.state.refresh(); assert.equal(f.state.value.budgetProfile, '50:5');
  f.state.setBudget('100:8'); await f.state.refresh(); assert.equal(f.state.value.budgetProfile, '100:8');
});
test('legacy null configuration retains bounded default', async () => {
  const f = fixture(); f.client.getKnowledgeStatus = async () => ({ lastBuild: { id: 'legacy', status: 'SUCCESS', configuration: null } });
  await f.state.refresh(); assert.equal(f.state.value.budgetProfile, '25:3');
});
test('late pre-enqueue status cannot replace new running job', async () => {
  const f = fixture(); await f.state.refresh();
  let resolve!: (value: unknown) => void;
  f.client.getKnowledgeStatus = () => new Promise(r => { resolve = r; });
  const stale = f.state.refresh(); await f.state.start('https://fixture.invalid');
  resolve({ lastBuild: previous }); await stale;
  assert.equal(f.state.value.status?.lastBuild.id, 'new'); assert.equal(f.timers.size, 1);
});
test('late RUNNING poll cannot resurrect a cancelled build', async () => {
  const f = fixture(); await f.state.refresh(); await f.state.start('https://fixture.invalid');
  let resolve!: (value: unknown) => void;
  f.client.getKnowledgeBuild = () => new Promise(r => { resolve = r; });
  const fn = [...f.timers.values()][0]; f.timers.clear(); fn();
  f.client.getKnowledgeBuild = async () => ({ ...previous, id: 'new', status: 'CANCELLED' });
  await f.state.cancel(); resolve({ id: 'new', status: 'RUNNING' }); await settle();
  assert.equal(f.state.value.status?.lastBuild.status, 'CANCELLED'); assert.equal(f.timers.size, 0);
});
test('unmount invalidates pending responses and timers', async () => {
  const f = fixture(); let resolve!: (value: unknown) => void;
  f.client.getKnowledgeStatus = () => new Promise(r => { resolve = r; });
  const pending = f.state.refresh(); f.state.stop(); resolve({ lastBuild: previous }); await pending;
  assert.equal(f.state.value.status, null); assert.equal(f.timers.size, 0);
});
test('status failures retry at most three times, and manual refresh recovers', async () => {
  const f = fixture(); let calls = 0;
  f.client.getKnowledgeStatus = async () => { calls++; throw Error('offline'); }; await f.state.refresh();
  for (let i = 0; i < 4; i++) { const fn = [...f.timers.values()][0]; f.timers.clear(); fn?.(); await settle(); }
  assert.equal(calls, 4); assert.equal(f.timers.size, 0); assert.equal(f.state.value.connectionLost, true);
  f.client.getKnowledgeStatus = async () => ({ lastBuild: previous }); await f.state.refresh();
  assert.equal(f.state.value.connectionLost, false);
});
test('reviewed enqueue adopts returned build identity immediately', async () => {
  const f = fixture(); await f.state.refresh(); f.setBuild({ ...previous, id: 'approved', status: 'RUNNING' });
  await f.state.queued('approved', 'QUEUED'); assert.equal(f.state.value.status?.lastBuild.id, 'approved'); assert.equal(f.timers.size, 1);
});
test('uncertain enqueue response recovers durable job from status', async () => {
  const f = fixture(); await f.state.refresh();
  f.client.queueKnowledgeBuild = async () => { f.setBuild({ ...previous, id: 'accepted', status: 'RUNNING' }); throw Error('timeout'); };
  await f.state.start('https://fixture.invalid'); assert.equal(f.state.value.status?.lastBuild.id, 'accepted'); assert.equal(f.timers.size, 1);
});
