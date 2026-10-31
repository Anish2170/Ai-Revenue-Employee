import assert from 'node:assert/strict';
import test from 'node:test';
import { browser, config } from './runtime.mjs';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
function fixture(t) {
  const events = [];
  const page = browser({ fetch: async (_url, init) => { events.push(...JSON.parse(init.body).events); return Response.json({ ok: true }); } });
  const identity = { visitorId: 'local-visitor', sessionId: 'local-session', visitorToken: 'local-proof', returning: false };
  const tracker = new page.AnalyticsTracker(config, identity);
  tracker.start(); t.after(() => tracker.stop());
  return { page, tracker, events };
}
test('SPA page exit retains the previous page instead of the new location', async t => {
  const { page, events } = fixture(t); await tick();
  page.context.window.location.pathname = '/doctors';
  page.context.window.location.href = 'https://customer.test/doctors';
  page.context.history.pushState(null, '', '/doctors'); await tick(); await tick();
  assert.equal(events.find(e => e.eventName === 'page_exited')?.pagePath, '/pricing');
  assert.equal(events.filter(e => e.eventName === 'page_viewed').at(-1)?.pagePath, '/doctors');
});
test('temporary tab hiding flushes analytics without inventing a visit end', async t => {
  const { page, tracker, events } = fixture(t); await tick();
  page.context.document.visibilityState = 'hidden'; page.dispatch('visibilitychange'); await tick();
  assert.equal(events.filter(e => e.eventName === 'session_ended').length, 0);
  assert.equal(events.filter(e => e.eventName === 'page_exited').length, 0);
  page.context.document.visibilityState = 'visible'; page.dispatch('visibilitychange');
  tracker.track('CHAT', 'chat_opened', { flush: true }); await tick();
  assert.ok(events.some(e => e.eventName === 'chat_opened'));
});
