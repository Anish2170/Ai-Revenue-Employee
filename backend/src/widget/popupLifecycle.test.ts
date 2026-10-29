import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { completePopup, failPopup, observePopupContext, reservePopup, transitionPopup, POPUP_LIFECYCLE, type PopupContext } from '../intelligence/popupLifecycle.js';
import { generateSafePopup } from '../intelligence/popupPipeline.js';
import { perceive } from '../intelligence/perceive.js';
import { SCENARIOS } from '../intelligence/__tests__/fixtures.js';

let next = 0;
function fixture(t: TestContext) {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const siteId = `phase2-life-${++next}`, session = sessionStore.getOrCreate(`${siteId}-session`, { siteId, returning: false });
  const context: PopupContext = { pageInstanceId: 'page-a', pageStartedAt: 1000, version: 1, blockedReason: null, formStalled: false };
  t.after(() => sessionStore.deleteSite(siteId));
  const reserve = () => reservePopup(session, context, session.latestEventTs ?? 1000);
  const ready = () => { const candidate = reserve().candidate!; assert.ok(candidate); assert.equal(completePopup(session, candidate), true); return candidate; };
  const move = (ms: number) => { now += ms; session.latestEventTs = (session.latestEventTs ?? 1000) + ms; };
  return { session, context, reserve, ready, move };
}

test('F07: synchronous reservation admits one of two concurrent eligible requests', t => {
  const f = fixture(t), one = f.reserve();
  assert.ok(one.candidate); assert.equal(f.reserve().reason, 'candidate_pending');
  assert.equal(f.session.priorInterruptions, 0);
});
test('F07: pending validated generation consumes no displayed budget; only claimed render receipt counts', t => {
  const f = fixture(t), c = f.ready();
  assert.equal(f.session.priorInterruptions, 0);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'displayed').ok, false);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'claim', f.context).ok, true);
  assert.equal(f.session.priorInterruptions, 0);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'displayed').changed, true);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'displayed').changed, false);
  assert.equal(f.session.priorInterruptions, 1);
  assert.equal(f.reserve().reason, 'cooldown');
});
test('F07: unclaimed expired popup frees display budget but attempt gap and total cap bound generation', t => {
  const f = fixture(t);
  for (let i = 0; i < POPUP_LIFECYCLE.maxAttempts; i++) { f.ready(); f.move(16_000); }
  assert.equal(f.session.priorInterruptions, 0);
  assert.equal(f.reserve().reason, 'generation_budget');
  assert.equal(f.session.popupLifecycle!.candidates.length, 6);
});
test('F07: unknown display receipts retain conservative slots instead of allowing unlimited displays', t => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) { const c = f.ready(); assert.equal(transitionPopup(f.session, c.id, 'page-a', 'claim', f.context).ok, true); f.move(26_000); }
  assert.equal(f.session.priorInterruptions, 0);
  assert.equal(f.reserve().reason, 'frequency_budget');
});
test('F07: delayed receipt after candidate expiry counts once and retains server wall cooldown', t => {
  const f = fixture(t), c = f.ready();
  transitionPopup(f.session, c.id, 'page-a', 'claim', f.context); f.move(26_000);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'displayed').ok, true);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'displayed').changed, false);
  assert.equal(f.session.priorInterruptions, 1); assert.equal(f.reserve().reason, 'cooldown');
});
test('F07: confirmed not-rendered release frees a claimed slot; displayed receipt cannot be refunded', t => {
  const f = fixture(t), c = f.ready();
  transitionPopup(f.session, c.id, 'page-a', 'claim', f.context);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'release').ok, true);
  assert.equal(c.unconfirmedClaim, false);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'displayed').ok, false);
  f.move(26_000); const next = f.ready();
  transitionPopup(f.session, next.id, 'page-a', 'claim', f.context);
  transitionPopup(f.session, next.id, 'page-a', 'displayed');
  assert.equal(transitionPopup(f.session, next.id, 'page-a', 'release').ok, false);
});
test('F07: claim retry is idempotent; expired permit cannot authorize another render', t => {
  const f = fixture(t), c = f.ready();
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'claim', f.context).changed, true);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'claim', f.context).changed, false);
  f.move(3001); assert.equal(transitionPopup(f.session, c.id, 'page-a', 'claim', f.context).ok, false);
});
test('F07: two confirmed displays exhaust the existing two-popup session budget', t => {
  const f = fixture(t);
  for (let i = 0; i < 2; i++) { const c = f.ready(); transitionPopup(f.session, c.id, 'page-a', 'claim', f.context); transitionPopup(f.session, c.id, 'page-a', 'displayed'); f.move(26_000); }
  assert.equal(f.session.priorInterruptions, 2); assert.equal(f.reserve().reason, 'frequency_budget');
});
test('F06/F14: changed typing, chat, hidden and conversion context cancel pending generation', t => {
  for (const reason of ['typing','chat_open','hidden','conversion_in_progress','converted','page_unstable','idle']) {
    const f = fixture(t), c = f.reserve().candidate!;
    assert.equal(observePopupContext(f.session, { ...f.context, version: 2, blockedReason: reason }), true);
    assert.equal(c.controller.signal.aborted, true); assert.equal(completePopup(f.session, c), false);
    assert.equal(f.session.priorInterruptions, 0);
  }
});
test('F07: older page requests and A-B-A late responses cannot replace current context', t => {
  const f = fixture(t), c = f.reserve().candidate!;
  assert.equal(observePopupContext(f.session, { ...f.context, pageInstanceId: 'page-b', pageStartedAt: 2000 }), true);
  assert.equal(c.controller.signal.aborted, true);
  assert.equal(observePopupContext(f.session, f.context), false);
  assert.equal(completePopup(f.session, c), false);
});
test('F07: old safety revisions and mismatched page/session candidate IDs cannot claim', t => {
  const f = fixture(t), c = f.ready();
  assert.equal(transitionPopup(f.session, c.id, 'another-page', 'claim', f.context).ok, false);
  assert.equal(transitionPopup(f.session, 'unknown', 'page-a', 'displayed').ok, false);
  observePopupContext(f.session, { ...f.context, version: 2 });
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'claim', f.context).ok, false);
});
test('F14: generation failures have bounded backoff independent of displayed-popup cooldown', t => {
  const f = fixture(t), c = f.reserve().candidate!;
  failPopup(f.session, c); assert.equal(f.reserve().reason, 'generation_backoff');
  f.move(5000); const next = f.reserve().candidate!; assert.ok(next);
  failPopup(f.session, next); f.move(9999); assert.equal(f.reserve().reason, 'generation_backoff');
  f.move(1); assert.ok(f.reserve().candidate); assert.equal(f.session.priorInterruptions, 0);
});
test('F07/F13: exact candidate click/dismiss outcomes are idempotent and keep dismissal sticky', t => {
  const f = fixture(t), c = f.ready();
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'clicked').ok, false);
  transitionPopup(f.session, c.id, 'page-a', 'claim', f.context); transitionPopup(f.session, c.id, 'page-a', 'displayed');
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'clicked').changed, true);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'clicked').changed, false);
  assert.equal(transitionPopup(f.session, c.id, 'page-a', 'dismissed').changed, true);
  assert.equal(f.session.dismissed, true); f.move(26_000); assert.equal(f.reserve().reason, 'dismissed');
});
test('F02/F07: independent tab/new signed sessions retain independent reservations and budgets', t => {
  const a = fixture(t), b = fixture(t), first = a.ready();
  assert.ok(b.reserve().candidate);
  assert.equal(transitionPopup(b.session, first.id, 'page-a', 'displayed').ok, false);
  assert.equal(b.session.priorInterruptions, 0);
});
test('F06: confirmed conversion remains a server gate across later page/reload contexts', t => {
  const f = fixture(t);
  observePopupContext(f.session, { ...f.context, version: 2, blockedReason: 'converted' });
  const newPage = { ...f.context, pageInstanceId: 'reloaded-page', pageStartedAt: 2000 };
  assert.equal(reservePopup(f.session, newPage, 2000).reason, 'converted');
});
test('F14: cancelled generations retain a deadline quarantine before another attempt', t => {
  const f = fixture(t), c = f.reserve().candidate!;
  observePopupContext(f.session, { ...f.context, version: 2, blockedReason: 'typing' });
  f.context.version = 3; f.move(5001); assert.equal(f.reserve().reason, 'generation_backoff');
  f.move(7000); assert.ok(f.reserve().candidate); assert.equal(c.controller.signal.aborted, true);
});
test('F06: real production pipeline uses support strategy and validated support action for a genuine form stall', async () => {
  const scenario = SCENARIOS.find(s => s.name === 'price-wall')!;
  const result = await generateSafePopup({ decision: perceive({ ...scenario }), objective: scenario.objective, formAssistance: true, business: { name: 'Test' },
    instructions: { businessName: 'Test', tone: 'helpful', alwaysBookDemo: false, avoidDiscounts: true, language: 'English' },
    businessActions: [{ actionId: 'support', label: 'Get help', destinationType: 'CHAT', destination: '', enabled: true }] },
    { knowledge: { retrieveFn: async () => ({ chunks: [{ id: 'support', url: '/help', page: '/help', pageType: 'other', section: 'help', heading: 'Help', title: 'Help', language: 'English', hash: 'test', lastCrawled: new Date().toISOString(), content: 'Our team can help with your questions.', score: 0.9 }], scores: [0.9] }) },
      llm: { available: () => true, generateStructured: async () => ({ title: 'Need help?', body: 'Our team can help with your questions.', primaryAction: 'support', secondaryAction: '', tone: 'supportive', popupType: 'support' }) } });
  assert.equal(result.ok, true); assert.equal(result.trace.strategy?.kind, 'Support');
  if (result.ok) assert.equal(result.popup.popup.primaryAction, 'support');
});
