import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:1/synthetic';
(globalThis as any).prisma = { aiDecisionLog: { async create() { throw new Error('Unexpected create'); }, async findFirst() { throw new Error('Unexpected find'); }, async update() { throw new Error('Unexpected update'); } } };
const { prisma } = await import('../db/prisma.js');
const { enqueueAiDecisionLog, enqueueAiDecisionOutcomes } = await import('./decision-log.service.js');
const tenant = { organizationId: 'org-test', websiteId: 'website-test' }, context = { sessionId: 'session-test' };
const id = '00000000-0000-4000-8000-000000000001';
const settle = () => new Promise(resolve => setTimeout(resolve, 25));

test('F13 dependency: generated decision uses candidate ID and outcomes query that exact tenant/session-bound row', async t => {
  const calls: any[] = [];
  t.mock.method(prisma.aiDecisionLog, 'create', async (args: any) => { calls.push(['create', args]); return {}; });
  t.mock.method(prisma.aiDecisionLog, 'findFirst', async (args: any) => { calls.push(['find', args]); return { id }; });
  t.mock.method(prisma.aiDecisionLog, 'update', async (args: any) => { calls.push(['update', args]); return {}; });
  enqueueAiDecisionLog(tenant, { ...context, id, decision: 'Popup Generated', finalOutcome: 'Generated', popupGenerated: true });
  enqueueAiDecisionLog(tenant, { ...context, decision: 'Suppressed', finalOutcome: 'Suppressed' });
  enqueueAiDecisionOutcomes(tenant, context, [{ category: 'POPUP', eventName: 'popup_clicked', decisionId: id }]);
  await settle();
  assert.equal(calls[0][1].data.id, id);
  const query = calls.find(call => call[0] === 'find')[1];
  assert.deepEqual(query.where, { id, ...tenant, sessionId: context.sessionId });
  assert.equal(Object.hasOwn(query, 'orderBy'), false);
  assert.equal(calls.find(call => call[0] === 'update')[1].data.popupClicked, true);
});
test('F13 dependency: missing correlation never updates the latest unrelated decision', async t => {
  const find = t.mock.method(prisma.aiDecisionLog, 'findFirst', async () => { throw new Error('Uncorrelated query must not run'); });
  enqueueAiDecisionOutcomes(tenant, context, [{ category: 'POPUP', eventName: 'popup_displayed' }, { category: 'CHAT', eventName: 'chat_opened' }]);
  await settle(); assert.equal(find.mock.callCount(), 0);
});
test('F13 dependency: candidate from another tenant/session cannot attach an outcome', async t => {
  const find = t.mock.method(prisma.aiDecisionLog, 'findFirst', async () => null);
  const update = t.mock.method(prisma.aiDecisionLog, 'update', async () => { throw new Error('No matching row'); });
  enqueueAiDecisionOutcomes(tenant, context, [{ category: 'POPUP', eventName: 'popup_dismissed', decisionId: id }]);
  await settle(); assert.equal(find.mock.callCount(), 1); assert.equal(update.mock.callCount(), 0);
});
test('F13 dependency: late display receipt preserves a previously clicked outcome', async t => {
  t.mock.method(prisma.aiDecisionLog, 'findFirst', async () => ({ id, finalOutcome: 'Clicked' }));
  const update = t.mock.method(prisma.aiDecisionLog, 'update', async () => ({}));
  enqueueAiDecisionOutcomes(tenant, context, [{ category: 'POPUP', eventName: 'popup_displayed', decisionId: id }]);
  await settle();
  const args = update.mock.calls[0].arguments[0] as any;
  assert.equal(args.data.popupDisplayed, true); assert.equal(Object.hasOwn(args.data, 'finalOutcome'), false);
});
