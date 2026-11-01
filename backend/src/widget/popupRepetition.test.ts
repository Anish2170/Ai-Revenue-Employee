import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { reservePopup, completePopup, transitionPopup, type PopupContext } from '../intelligence/popupLifecycle.js';
let next = 0;
const message = { title: 'Review published pricing', body: 'Explore published prices and plan conditions before choosing your next step.', actionKey: 'URL:https://fixture.example/pricing' };
function fixture(t: TestContext) {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const siteId = `repetition-${++next}`, session = sessionStore.getOrCreate(siteId, { siteId, returning: false });
  t.after(() => sessionStore.deleteSite(siteId));
  let context: PopupContext = { pageInstanceId: 'page-a', pageStartedAt: 1000, version: 1, blockedReason: null };
  const advance = () => { now += 26_000; session.latestEventTs = now; context = { ...context, pageInstanceId: 'page-' + now, pageStartedAt: now }; };
  const ready = (copy = message) => {
    const c = reservePopup(session, context, now).candidate; assert.ok(c);
    return { c, ok: completePopup(session, c, copy) };
  };
  const display = (c: ReturnType<typeof ready>['c'], receipt = true) => {
    assert.ok(transitionPopup(session, c.id, context.pageInstanceId, 'claim', context).ok);
    if (receipt) assert.ok(transitionPopup(session, c.id, context.pageInstanceId, 'displayed').ok);
  };
  return { session, advance, ready, display, context: () => context };
}
test('different IDs cannot repeat identical visible content after navigation and cooldown', t => {
  const f = fixture(t), first = f.ready(); assert.ok(first.ok); f.display(first.c); f.advance();
  const second = f.ready(); assert.notEqual(first.c.id, second.c.id); assert.equal(second.ok, false);
  assert.equal(f.session.priorInterruptions, 1);
});
test('minor copy variation with the same destination is suppressed regardless of strategy', t => {
  const f = fixture(t), first = f.ready(); f.display(first.c); f.advance();
  assert.equal(f.ready({ ...message, title: 'Review our published pricing', body: 'Explore published prices and plan conditions before choosing the next step.' }).ok, false);
});
test('an unknown display receipt conservatively retains content deduplication', t => {
  const f = fixture(t), first = f.ready(); f.display(first.c, false); f.advance();
  assert.equal(f.ready().ok, false); assert.equal(f.session.priorInterruptions, 0);
});
test('a generated but never claimed candidate does not count as repeated visible display', t => {
  const f = fixture(t); f.ready(); f.advance(); assert.equal(f.ready().ok, true);
});
test('a confirmed not-rendered candidate does not suppress the same future message', t => {
  const f = fixture(t), first = f.ready(); f.display(first.c, false);
  assert.ok(transitionPopup(f.session, first.c.id, f.context().pageInstanceId, 'release').ok);
  f.advance(); assert.equal(f.ready().ok, true);
});
test('a materially different helpful message remains eligible after cooldown', t => {
  const f = fixture(t), first = f.ready(); f.display(first.c); f.advance();
  assert.equal(f.ready({ ...message, title: 'Need account support?', body: 'Support hours are Monday to Friday. Read the support policy.', actionKey: 'URL:https://fixture.example/support' }).ok, true);
});
test('navigation preserves cooldown, two-display budget and chat suppression', t => {
  const f = fixture(t), first = f.ready(); f.display(first.c);
  assert.equal(reservePopup(f.session, { ...f.context(), pageInstanceId: 'page-b', pageStartedAt: 2000 }, Date.now()).reason, 'cooldown');
  f.advance();
  assert.equal(reservePopup(f.session, { ...f.context(), version: 2, blockedReason: 'chat_open' }, Date.now()).reason, 'chat_open');
  f.context().version = 3;
  const second = f.ready({ ...message, body: 'Support is available on weekdays.', actionKey: 'URL:https://fixture.example/support' }); f.display(second.c); f.advance();
  assert.equal(reservePopup(f.session, f.context(), Date.now()).reason, 'frequency_budget');
});
