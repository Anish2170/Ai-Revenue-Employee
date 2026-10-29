import assert from 'node:assert/strict';
import test from 'node:test';
import { browser, config, storage, scheduler } from './runtime.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const identity = { visitorId: 'visitor-phase2', sessionId: 'session-phase2', visitorToken: 'signed-phase2', expiresAt: 1_900_000_000_000, sessionStartedAt: 1_800_000_000_000, returning: false };
class Node {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = new Map(); this.listeners = new Map(); this.classList = { add() {} }; this.textContent = ''; }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  hasAttribute(key) { return this.attrs.has(key); }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  closest() { return null; }
  matches(selector) { return this.editable ? /textarea|role=textbox/.test(selector) : false; }
  querySelectorAll() { return this.children.filter(node => node.className === 'aire-popup'); }
  getClientRects() { return [{}]; }
}
function safetyFixture(t) {
  const clock = { now: identity.sessionStartedAt }, timers = scheduler(clock), page = browser({ clock, timers });
  page.context.document.activeElement = null; page.context.document.readyState = 'complete';
  const changes = [], safety = new page.InterruptionSafety(value => changes.push(value));
  safety.start(); t.after(() => safety.stop());
  return { page, safety, clock, timers, changes };
}
function field(page) { const node = new Node('textarea'); node.editable = true; page.context.document.activeElement = node; page.dispatch('focusin', { target: node }); return node; }

test('F06: navigation stability, current typing and form progression override prior eligibility', async t => {
  const f = safetyFixture(t); assert.equal(f.safety.snapshot().blockedReason, 'page_unstable');
  await f.timers.advance(1000); assert.equal(f.safety.snapshot().blockedReason, null);
  const input = field(f.page); assert.equal(f.safety.snapshot().blockedReason, 'form_progress');
  f.page.dispatch('input', { target: input }); assert.equal(f.safety.snapshot().blockedReason, 'typing');
  await f.timers.advance(4000); f.page.dispatch('input', { target: input });
  await f.timers.advance(4000); assert.equal(f.safety.snapshot().blockedReason, 'form_progress');
});
test('F06: genuine eight-second form pause permits contextual assistance, then true inactivity blocks it', async t => {
  const f = safetyFixture(t); await f.timers.advance(1000); const input = field(f.page);
  f.page.dispatch('input', { target: input }); await f.timers.advance(8000);
  assert.equal(f.safety.snapshot().formStalled, true); assert.equal(f.safety.snapshot().blockedReason, null);
  await f.timers.advance(22_000); assert.equal(f.safety.snapshot().blockedReason, 'idle');
  f.page.dispatch('input', { target: input }); assert.equal(f.safety.snapshot().blockedReason, 'typing');
});
test('F06: IME composition, select changes and contenteditable-style inputs stay protected', async t => {
  const f = safetyFixture(t); await f.timers.advance(1000); const input = field(f.page);
  f.page.dispatch('compositionstart', { target: input }); await f.timers.advance(10_000);
  assert.equal(f.safety.snapshot().blockedReason, 'typing');
  f.page.dispatch('compositionend', { target: input }); assert.equal(f.safety.snapshot().blockedReason, 'typing');
  await f.timers.advance(3000); f.page.dispatch('change', { target: input }); assert.equal(f.safety.snapshot().blockedReason, 'typing');
});
test('F06: hidden, idle/resume, checkout, modal and focused payment iframe cannot be interrupted', async t => {
  const f = safetyFixture(t); await f.timers.advance(1000);
  f.page.context.document.visibilityState = 'hidden'; f.page.dispatch('visibilitychange'); assert.equal(f.safety.snapshot().blockedReason, 'hidden');
  f.page.context.document.visibilityState = 'visible'; await f.timers.advance(12_000); assert.equal(f.safety.snapshot().blockedReason, 'idle');
  f.page.dispatch('touchstart'); assert.equal(f.safety.snapshot().blockedReason, null);
  f.page.context.window.location.pathname = '/checkout'; assert.equal(f.safety.snapshot().blockedReason, 'critical_interaction');
  f.page.context.window.location.pathname = '/pricing'; f.page.context.document.querySelectorAll = () => [new Node('dialog')];
  assert.equal(f.safety.snapshot().blockedReason, 'critical_interaction');
  f.page.context.document.querySelectorAll = () => []; f.page.context.document.activeElement = { matches: selector => selector.includes('iframe'), closest: () => null };
  assert.equal(f.safety.snapshot().blockedReason, 'critical_interaction');
});
test('F06: native submit pauses sales, explicit failure recovers, confirmed conversion stays sticky until session renewal', async t => {
  const f = safetyFixture(t); await f.timers.advance(1000);
  f.page.dispatch('submit', { target: new Node('form') }); assert.equal(f.safety.snapshot().blockedReason, 'conversion_in_progress');
  f.page.dispatch('aire:conversion', { detail: { status: 'error' } }); assert.equal(f.safety.snapshot().blockedReason, null);
  f.page.dispatch('aire:conversion', { detail: { status: 'success' } }); f.safety.navigate(); await f.timers.advance(1000);
  assert.equal(f.safety.snapshot().blockedReason, 'converted'); f.safety.renewSession(); await f.timers.advance(1000);
  assert.equal(f.safety.snapshot().blockedReason, null);
});

function appFixture(fetch, options = {}) {
  const page = browser({ fetch, ...options }), app = new page.Orchestrator(config);
  page.context.document.createElement = tag => new Node(tag);
  page.context.document.activeElement = null;
  app.identity = { ...identity, sessionStartedAt: page.clock.now }; app.sessionId = identity.sessionId;
  app.session = new page.SessionManager(config.siteId); app.session.bind(identity.sessionId);
  app.root = { layer: new Node() }; app.chat = { isOpen: false, async open() { this.isOpen = true; } };
  app.safety.stableAt = 0;
  const artifact = () => ({ title: 'Questions?', body: 'Our team can help.', popupType: 'trust', tone: 'reassuring', delivery: { version: 2, popupId: '00000000-0000-4000-8000-000000000001', decisionId: '00000000-0000-4000-8000-000000000001', pageInstanceId: app.pageInstanceId, contextVersion: app.safety.snapshot().version, formAssistance: false, expiresAt: page.clock.now + 15_000 } });
  return { page, app, artifact };
}
test('F07: successful DOM render records one local display and sends claim then display acknowledgement', async () => {
  const operations = []; const f = appFixture(async (_url, init) => { const body = JSON.parse(init.body); operations.push(body.operation); return Response.json({ ok: true, claimUntil: f.page.clock.now + 3000 }); });
  const popup = f.artifact(); await f.app.onPipelinePopup(popup); await tick();
  assert.equal(f.app.session.get().engageCount, 1); assert.ok(f.app.popup);
  assert.deepEqual(operations, ['claim','displayed']);
  await f.app.onPipelinePopup(popup); assert.equal(f.app.session.get().engageCount, 1);
});
test('F06/F07: activity changes while a render claim is in flight prevent rendering and release the unused permit', async () => {
  let finish; const operations = [];
  const f = appFixture(async (_url, init) => { const body = JSON.parse(init.body); operations.push(body.operation); if (body.operation === 'claim') return new Promise(resolve => { finish = resolve; }); return Response.json({ ok: true }); });
  const pending = f.app.onPipelinePopup(f.artifact());
  f.app.safety.setChatOpen(true); finish(Response.json({ ok: true, claimUntil: f.page.clock.now + 3000 }));
  await pending; await tick(); assert.equal(f.app.popup, null); assert.equal(f.app.session.get().engageCount, 0); assert.ok(operations.includes('release'));
});
test('F07: navigation/session changes, expiration and two racing candidates cannot render obsolete popup', async () => {
  let finish; let claims = 0;
  const f = appFixture(async (_url, init) => { if (JSON.parse(init.body).operation === 'claim') { claims++; return new Promise(resolve => { finish = resolve; }); } return Response.json({ ok: true }); });
  const popup = f.artifact(); const one = f.app.onPipelinePopup(popup), two = f.app.onPipelinePopup(popup);
  f.app.pageInstanceId = 'new-page'; finish(Response.json({ ok: true, claimUntil: f.page.clock.now + 3000 }));
  await Promise.all([one,two]); assert.equal(claims, 1); assert.equal(f.app.session.get().engageCount, 0);
  const old = f.artifact(); f.app.identity = { ...f.app.identity, sessionId: 'renewed-session' }; f.app.pageInstanceId = 'renewed-page'; await f.app.onPipelinePopup(old);
  const expired = f.artifact(); expired.delivery.expiresAt = f.page.clock.now - 1; await f.app.onPipelinePopup(expired);
  assert.equal(claims, 1);
});
test('F07: renderer failure does not spend a display count and releases the candidate', async () => {
  const operations = []; const f = appFixture(async (_url, init) => { operations.push(JSON.parse(init.body).operation); return Response.json({ ok: true, claimUntil: f.page.clock.now + 3000 }); });
  f.page.context.document.createElement = () => { throw new Error('DOM unavailable'); };
  await f.app.onPipelinePopup(f.artifact()); await tick(); assert.equal(f.app.session.get().engageCount, 0); assert.deepEqual(operations, ['claim','release']);
});
test('F12: opening chat immediately removes a visible popup and invalidates pending popup eligibility', async () => {
  const f = appFixture(async () => Response.json({ ok: true, claimUntil: f.page.clock.now + 3000 }));
  await f.app.onPipelinePopup(f.artifact()); assert.equal(f.app.root.layer.children.length, 1);
  f.app.openChat(); assert.equal(f.app.popup, null); assert.equal(f.app.root.layer.children.length, 0); assert.equal(f.app.chat.isOpen, true);
  assert.equal(f.app.safety.snapshot().blockedReason, 'chat_open');
});
test('F06: changed safety version, hidden document and generic sales artifact during form stall are rejected', async () => {
  const operations = []; const f = appFixture(async (_url, init) => { operations.push(JSON.parse(init.body).operation); return Response.json({ ok: true }); });
  const old = f.artifact(); f.app.safety.version++; await f.app.onPipelinePopup(old);
  f.page.context.document.visibilityState = 'hidden'; await f.app.onPipelinePopup(f.artifact());
  f.page.context.document.visibilityState = 'visible'; const input = new Node('textarea'); input.editable = true; f.page.context.document.activeElement = input;
  f.app.safety.focusedAt = f.page.clock.now - 9000; await f.app.onPipelinePopup(f.artifact());
  await tick(); assert.equal(f.app.session.get().engageCount, 0); assert.ok(operations.length > 0); assert.ok(operations.every(operation => operation === 'release'), 'only release notifications, never a render claim');
});
test('F07: rejected or expired display permits cannot spend local counters', async () => {
  const f = appFixture(async () => Response.json({ ok: true, claimUntil: f.page.clock.now - 1 }));
  await f.app.onPipelinePopup(f.artifact()); assert.equal(f.app.session.get().engageCount, 0); assert.equal(f.app.popup, null);
});
test('F07: receipt retries are bounded and ordered; a reload replays the exact signed display receipt', async () => {
  const clock = { now: identity.sessionStartedAt }, timers = scheduler(clock), session = storage(); let calls = 0;
  const first = browser({ clock, timers, session, fetch: async () => { calls++; throw new Error('offline'); } });
  const delivery = new first.PopupDelivery(config); delivery.resume(identity);
  const meta = { popupId: 'popup-one', pageInstanceId: 'page-one' };
  delivery.notify('displayed', meta, identity); delivery.notify('displayed', meta, identity); delivery.notify('clicked', meta, identity);
  await timers.advance(3000); assert.equal(calls, 3);
  const bodies = [], second = browser({ session, fetch: async (_url, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ ok: true }); } });
  new second.PopupDelivery(config).resume(identity); await tick(); await tick();
  assert.deepEqual(bodies.map(body => body.operation), ['displayed','clicked']); assert.equal(bodies[0].visitorToken, identity.visitorToken); assert.equal(bodies[0].popupId, 'popup-one');
});
test('F05/F07: blocked receipt storage still acknowledges display in memory', async () => {
  const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } }, operations = [];
  const f = appFixture(async (_url, init) => { operations.push(JSON.parse(init.body).operation); return Response.json({ ok: true, claimUntil: f.page.clock.now + 3000 }); }, { session: blocked });
  await f.app.onPipelinePopup(f.artifact()); await tick(); assert.equal(f.app.session.get().engageCount, 1); assert.deepEqual(operations, ['claim','displayed']);
});
test('F14: sensor cancellation reaches fetch and rejects late JSON even when transport ignores abort', async () => {
  let finish, signal, delivered = 0;
  const page = browser({ fetch: async (_url, init) => { signal = init.signal; return new Promise(resolve => { finish = resolve; }); } });
  const context = { pageInstanceId: 'page', pageStartedAt: 0, version: 1, blockedReason: null, formStalled: false };
  const sensor = new page.SensorEngine({ ...config, identity, getIdentity: async () => identity, getClientState: () => ({}), getPageContext: () => context, onPopup: () => delivered++ });
  await sensor.send([{ type: 'pricing_focus', zone: 'pricing', ts: 1000, intensity: 0.9, surface: 'desktop' }]);
  sensor.cancelPending(); assert.equal(signal.aborted, true);
  finish(Response.json({ popup: { title: 'Late', body: 'Late', tone: 'helpful', popupType: 'trust' } })); await tick(); assert.equal(delivered, 0); sensor.stop();
});
test('F07: online/visible receipt recovery is bounded and cannot keep an exhausted old-session outbox in the way', async () => {
  const clock = { now: identity.sessionStartedAt }, timers = scheduler(clock); let calls = 0, offline = true;
  const page = browser({ clock, timers, fetch: async () => { calls++; if (offline) throw new Error('offline'); return Response.json({ ok: true }); } });
  const delivery = new page.PopupDelivery(config); delivery.resume(identity);
  delivery.notify('displayed', { popupId: 'old-popup', pageInstanceId: 'old-page' }, identity);
  await timers.advance(3000); assert.equal(calls, 3);
  delivery.resume(identity); await timers.advance(0); assert.equal(calls, 3);
  offline = false; await timers.advance(2500); delivery.resume(identity); await tick(); assert.equal(calls, 4);
  assert.equal(delivery.receipts.length, 0);
  offline = true; delivery.notify('displayed', { popupId: 'new-old-popup', pageInstanceId: 'old-page' }, identity); await timers.advance(3000);
  delivery.resume({ ...identity, sessionId: 'renewed-session' }); assert.equal(delivery.receipts.length, 0);
});
test('F07: optional legacy evaluation that returns no popup must not consume displayed-popup count', async () => {
  const f = appFixture(async () => Response.json({ ok: true }));
  f.app.api = { postEngage: async () => ({ showPopup: false }) };
  f.app.tracker = { snapshot: () => ({ page: '/pricing', timeOnPage: 50 }) };
  await f.app.tryEngage('dwell');
  assert.equal(f.app.session.get().engageCount, 0);
  assert.equal(f.app.session.get().lastEngageAt, null);
});
