import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EventEmitter } from 'node:events';
process.env.DATABASE_URL = '';
process.env.DEBUG_TRACE = 'false';
const { eventsRouter } = await import('../routes/events.js');
const { sessionStore } = await import('../intelligence/session/visitorSession.js');
const { reservePopup, completePopup } = await import('../intelligence/popupLifecycle.js');
const { issuePublicWidgetIdentity } = await import('./publicIdentity.js');

async function call(path: string, body: unknown) {
  const handler = eventsRouter.stack.find(layer => layer.route?.path === path)!.route!.stack.at(-1)!.handle;
  let payload: any, status = 200;
  const req = Object.assign(new EventEmitter(), { body, query: {}, get: () => undefined });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, status(value: number) { status = value; return this; }, json(value: unknown) { payload = value; this.writableEnded = true; return this; } });
  await handler(req as never, res as never, () => {});
  return { status, body: payload };
}
let next = 0;
function fixture(t: TestContext) {
  const { identity, token } = issuePublicWidgetIdentity(`phase2-route-${++next}`);
  const session = sessionStore.getOrCreate(identity.sessionId, { siteId: identity.siteId, returning: false });
  t.after(() => sessionStore.deleteSite(identity.siteId));
  const context = { pageInstanceId: '00000000-0000-4000-8000-000000000001', pageStartedAt: 1000, version: 0, blockedReason: null, formStalled: false };
  const candidate = reservePopup(session, context, 1000).candidate!; completePopup(session, candidate);
  const body = { siteId: identity.siteId, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: token, popupId: candidate.id, pageInstanceId: context.pageInstanceId };
  const op = (operation: string, extra = {}) => call('/popup/lifecycle', { ...body, operation, ...extra });
  return { op, body, context, candidate, session };
}
test('F07 HTTP contract: valid signed claim and duplicate display receipts update budget exactly once', async t => {
  const f = fixture(t);
  assert.equal((await f.op('claim', { context: f.context })).body.ok, true);
  const replies = await Promise.all([f.op('displayed'), f.op('displayed')]);
  assert.ok(replies.every(reply => reply.body.ok)); assert.equal(f.session.priorInterruptions, 1);
  assert.equal((await f.op('dismissed')).body.ok, true); assert.equal(f.session.dismissed, true);
});
test('F02/F07 HTTP contract: wrong site, visitor, session or token cannot claim or acknowledge', async t => {
  const f = fixture(t);
  for (const field of ['siteId','visitorId','sessionId','visitorToken']) {
    const reply = await f.op('claim', { [field]: 'unrelated', context: f.context });
    assert.equal(reply.status, 403); assert.equal(reply.body.ok, false);
  }
  assert.equal(f.session.priorInterruptions, 0);
});
test('F06/F07 HTTP contract: later blocked context invalidates pending candidate before display claim', async t => {
  const f = fixture(t);
  assert.equal((await f.op('context', { context: { ...f.context, version: 1, blockedReason: 'typing' } })).body.ok, true);
  assert.equal((await f.op('claim', { context: f.context })).body.ok, false);
  assert.equal(f.candidate.status, 'released'); assert.equal(f.session.priorInterruptions, 0);
});
test('F07 HTTP contract: unclaimed, unknown, wrong-page and post-restart acknowledgements fail closed', async t => {
  const f = fixture(t);
  assert.equal((await f.op('displayed')).body.ok, false);
  assert.equal((await f.op('claim', { pageInstanceId: '00000000-0000-4000-8000-000000000002', context: f.context })).body.ok, false);
  assert.equal((await f.op('displayed', { popupId: '00000000-0000-4000-8000-000000000003' })).body.ok, false);
  sessionStore.deleteSite(f.body.siteId);
  assert.equal((await f.op('displayed')).body.reason, 'session_unavailable');
});
test('F07 HTTP contract: invalid lifecycle payloads cannot mutate display counters', async t => {
  const f = fixture(t);
  assert.equal((await f.op('claim', { popupId: 'bad-uuid' })).status, 400);
  assert.equal((await f.op('context', { context: { ...f.context, pageInstanceId: '00000000-0000-4000-8000-000000000002' } })).status, 400);
  assert.equal(f.session.priorInterruptions, 0);
});
