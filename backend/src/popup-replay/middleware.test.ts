import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
process.env.DATABASE_URL = ''; process.env.OPENAI_API_KEY = ''; process.env.GEMINI_API_KEY = '';
(globalThis as unknown as { prisma: unknown }).prisma = {
  popupReplayRun: { findUnique: async () => null, findFirst: async () => null },
  website: { findFirst: async () => null }, $executeRaw: async () => 1,
};
const { prisma } = await import('../db/prisma.js');
const { issueReplayWidgetIdentity } = await import('../widget/publicIdentity.js');
const { replayWidgetMiddleware } = await import('./middleware.js');
const { currentReplay } = await import('./runtime.js');
const runId = '761bccb5-6aeb-43b2-9c02-0b35324c37e0', lease = 'a'.repeat(43);
function request(body: unknown, header?: string, path = '/events') {
  let status = 200, payload: unknown, context: ReturnType<typeof currentReplay>, continued = false;
  const req = { body, method: 'POST', path, get: (key: string) => key === 'x-popup-replay' ? header : undefined };
  const res = { status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; return this; } };
  return { call: async () => { await replayWidgetMiddleware(req as never, res as never, () => { continued = true; context = currentReplay(); }); return { status, payload, continued, context }; } };
}
function fixture(t: TestContext) {
  const issued = issueReplayWidgetIdentity('site-a', runId);
  const body = { siteId: 'site-a', visitorToken: issued.token, visitorId: issued.identity.visitorId, sessionId: issued.identity.sessionId };
  const runner: { id: string; revokedAt: Date | null; expiresAt: Date } = { id: 'runner-a', revokedAt: null, expiresAt: new Date(Date.now() + 60000) };
  const batch = { id: 'batch-a', runnerId: runner.id, websiteId: 'website-a', organizationId: 'org-a', status: 'RUNNING', expiresAt: new Date(Date.now() + 60000), runner };
  const run = { id: runId, batchId: batch.id, status: 'RUNNING', visitorId: body.visitorId, sessionId: body.sessionId, leaseExpiresAt: new Date(Date.now() + 60000), batch };
  t.mock.method(prisma.popupReplayRun, 'findUnique', async () => run);
  t.mock.method(prisma.popupReplayRun, 'findFirst', async () => run);
  t.mock.method(prisma.website, 'findFirst', async () => ({ widget: { status: 'ACTIVE', siteId: 'site-a' } }));
  return { body, run, batch, runner };
}
test('ordinary traffic requires no replay DB lookup and gets no QA scope', async t => {
  t.mock.method(prisma.popupReplayRun, 'findUnique', async () => { throw Error('Unexpected DB lookup'); });
  assert.deepEqual(await request({ siteId: 'site-a' }).call(), { status: 200, payload: undefined, continued: true, context: undefined });
});
test('valid leased QA request gets scope only for its own site and identity', async t => {
  const f = fixture(t); const result = await request(f.body, `${runId}.${lease}`).call();
  assert.equal(result.continued, true); assert.equal(result.context?.runId, runId); assert.equal(currentReplay(), undefined);
});
test('a signed QA visitor proof cannot be used without a live replay lease', async t => {
  const f = fixture(t); assert.equal((await request(f.body).call()).status, 403);
  assert.equal((await request(f.body, 'forged').call()).status, 403);
});
test('cross-site/session binding and chat or conversation writes are rejected', async t => {
  const f = fixture(t);
  for (const body of [{ ...f.body, siteId: 'other' }, { ...f.body, sessionId: 'other' }, { ...f.body, visitorId: 'other' }]) assert.equal((await request(body, `${runId}.${lease}`).call()).status, 403);
  for (const path of ['/chat', '/conversations', '/engage']) assert.equal((await request(f.body, `${runId}.${lease}`, path).call()).status, 403);
});
test('stop, revoke, expiry and stale browser leases cannot authorize QA', async t => {
  const f = fixture(t); f.batch.status = 'CANCELLED';
  assert.equal((await request(f.body, `${runId}.${lease}`).call()).status, 403); f.batch.status = 'RUNNING';
  f.runner.revokedAt = new Date(); assert.equal((await request(f.body, `${runId}.${lease}`).call()).status, 403); f.runner.revokedAt = null;
  f.run.leaseExpiresAt = new Date(0); assert.equal((await request(f.body, `${runId}.${lease}`).call()).status, 403);
});
test('analytics from a verified test run is captured separately and never reaches normal ingestion', async t => {
  const f = fixture(t); let appended = 0;
  t.mock.method(prisma, '$executeRaw', async () => { appended++; return 1; });
  const result = await request({ ...f.body, events: [{ category: 'POPUP', eventName: 'popup_displayed' }] }, `${runId}.${lease}`, '/analytics/events').call();
  assert.equal(result.continued, false); assert.equal(result.status, 200); assert.equal(appended, 1);
});
