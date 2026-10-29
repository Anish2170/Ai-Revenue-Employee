import assert from 'node:assert/strict';
import test from 'node:test';
import { browser, config, identityServer, storage } from './runtime.mjs';

test('popup suppression and cooldown persist within the same visit and reset for a new session', () => {
  const session = storage();
  const page = browser({ session });
  const state = new page.SessionManager('site-a');
  state.bind('session-one');
  state.markEngaged(); state.markPopupShown(); state.markDismissed();
  const reload = new (browser({ session }).SessionManager)('site-a');
  reload.bind('session-one');
  assert.equal(reload.get().engageCount, 1);
  assert.equal(reload.get().lastEngageAt, page.clock.now);
  assert.equal(reload.get().dismissed, true);
  assert.equal(reload.get().popupShown, false, 'F04: a new document resets only the page flag');
  reload.bind('session-two');
  assert.deepEqual(JSON.parse(JSON.stringify(reload.get())), { popupShown: false, lastEngageAt: null, engageCount: 0, dismissed: false });
});

test('popup state is scoped by site and ignores unbound legacy counters', () => {
  const session = storage([['aire_session_v1', JSON.stringify({ dismissed: true, engageCount: 99 })]]);
  const page = browser({ session });
  const a = new page.SessionManager('site-a'), b = new page.SessionManager('site-b');
  a.bind('shared-session'); a.markDismissed();
  b.bind('shared-session');
  assert.equal(b.get().dismissed, false);
  assert.equal(b.get().engageCount, 0);
});

test('same-session rebinding keeps counters and navigation preserves frequency/cooldown', () => {
  const page = browser();
  const state = new page.SessionManager('site-a');
  state.bind('session-one'); state.markEngaged(); state.markPopupShown(); state.markDismissed();
  state.bind('session-one');
  assert.equal(state.get().dismissed, true);
  state.resetForPage();
  assert.equal(state.get().dismissed, true, 'F04: dismissal persists across pages');
  assert.equal(state.get().popupShown, false);
  assert.equal(state.get().engageCount, 1);
  assert.equal(state.get().lastEngageAt, page.clock.now);
});

test('semantic timestamps continue across reload instead of restarting cooldown time', async () => {
  const local = storage(), session = storage(), clock = { now: 1_800_000_000_000 }, server = identityServer(clock);
  const first = browser({ local, session, clock, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  const timestamps = [];
  const emitter = new first.EventEmitter({ surface: 'desktop', sessionStartedAt: a.sessionStartedAt, maxBuffer: 1, send: events => timestamps.push(events[0].ts) });
  clock.now += 60_000;
  emitter.emit('content_dwell', 'pricing', 0.8);
  first.touchWidgetSession(config, a);
  clock.now += 10_000;
  const next = browser({ local, session, clock, fetch: server.fetch });
  const b = await new next.ApiClient(config).getIdentity();
  const nextEmitter = new next.EventEmitter({ surface: 'desktop', sessionStartedAt: b.sessionStartedAt, maxBuffer: 1, send: events => timestamps.push(events[0].ts) });
  nextEmitter.emit('content_dwell', 'pricing', 0.8);
  assert.equal(b.sessionId, a.sessionId);
  assert.deepEqual(timestamps, [60_000, 70_000]);
  assert.equal(timestamps[1] - timestamps[0], 10_000);
});

test('engage, conversations, semantic events and analytics use the same signed visit and returning flag', async () => {
  const server = identityServer(), calls = [];
  const page = browser({ fetch: (url, init) => {
    if (url.endsWith('/widget/session')) return server.fetch(url, init);
    calls.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve(Response.json({ showPopup: false }));
  } });
  const api = new page.ApiClient(config);
  const identity = await api.getIdentity();
  await api.postEngage({}, { popupShown: false, engageCount: 0, lastEngageAt: null, dismissed: false });
  await api.restoreConversation({});
  const sensors = new page.SensorEngine({ ...config, identity, getIdentity: () => api.getIdentity(), getClientState: () => ({}), onPopup() {} });
  await sensors.send([{ type: 'content_dwell', zone: 'pricing', intensity: 0.8, ts: 1000, surface: 'desktop' }]);
  const analytics = new page.AnalyticsTracker(config, identity);
  analytics.track('PAGE', 'page_viewed', { flush: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.length, 4);
  for (const { body } of calls) {
    assert.equal(body.visitorId, identity.visitorId);
    assert.equal(body.sessionId, identity.sessionId);
    assert.equal(body.visitorToken, identity.visitorToken);
  }
  assert.equal(calls.find(call => call.url.endsWith('/events')).body.returning, false);
  assert.equal(calls.find(call => call.url.endsWith('/analytics/events')).body.returning, false);
  assert.equal(server.calls.length, 1);
});

test('live session renewal resets suppression, restarts transports and discards old popup responses', async () => {
  const clock = { now: 1_800_000_000_000 }, server = identityServer(clock), shown = [];
  let completeOldResponse;
  const page = browser({ clock, fetch: (url, init) => {
    if (url.endsWith('/widget/session')) return server.fetch(url, init);
    return new Promise(resolve => { completeOldResponse = resolve; });
  } });
  const app = new page.Orchestrator(config);
  const api = new page.ApiClient(config, identity => app.renewSession(identity));
  app.api = api;
  const a = await api.getIdentity();
  app.sessionId = a.sessionId;
  app.session = new page.SessionManager(config.siteId);
  app.session.bind(a.sessionId);
  app.session.markEngaged(); app.session.markDismissed();
  let stoppedAnalytics = false, removedPopup = false, newAnalyticsId;
  app.analytics = { stop() { stoppedAnalytics = true; } };
  app.popup = { remove() { removedPopup = true; } };
  app.startAnalytics = identity => { newAnalyticsId = identity.sessionId; };
  app.startSensors = identity => {
    app.sensors = new page.SensorEngine({ ...config, identity, getIdentity: () => api.getIdentity(), getClientState: () => ({}), onPopup: popup => shown.push(popup) });
  };
  app.startSensors(a);
  const oldSensors = app.sensors;
  await oldSensors.send([{ type: 'content_dwell', zone: 'pricing', intensity: 0.8, ts: 1000, surface: 'desktop' }]);
  clock.now += 30 * 60_000;
  const b = await api.getIdentity();
  assert.notEqual(b.sessionId, a.sessionId);
  assert.equal(app.session.get().engageCount, 0);
  assert.equal(app.session.get().dismissed, false);
  assert.equal(app.sensors.sessionId, b.sessionId);
  assert.equal(newAnalyticsId, b.sessionId);
  assert.equal(stoppedAnalytics, true);
  assert.equal(removedPopup, true);
  completeOldResponse(Response.json({ popup: { title: 'Old', body: 'Old response', tone: 'helpful', popupType: 'educational' } }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(shown.length, 0);
  const calls = server.calls.length;
  await oldSensors.send([]);
  assert.equal(server.calls.length, calls);
});

test('SPA analytics history hooks follow the replacement tracker after visit renewal', async t => {
  const clock = { now: 1_800_000_000_000 }, server = identityServer(clock), bodies = [];
  const page = browser({ clock, fetch: (url, init) => {
    if (url.endsWith('/widget/session')) return server.fetch(url, init);
    bodies.push(JSON.parse(init.body));
    return Promise.resolve(Response.json({}));
  } });
  const api = new page.ApiClient(config);
  const a = await api.getIdentity();
  const oldTracker = new page.AnalyticsTracker(config, a);
  oldTracker.start();
  t.after(() => oldTracker.stop());
  clock.now += 30 * 60_000;
  const b = await api.getIdentity();
  oldTracker.stop();
  const current = new page.AnalyticsTracker(config, b);
  current.start();
  t.after(() => current.stop());
  await new Promise(resolve => setTimeout(resolve, 0));
  page.context.history.pushState({}, '', '/new-page');
  await new Promise(resolve => setTimeout(resolve, 10));
  const views = bodies.flatMap(body => body.events.map(event => ({ ...event, sessionId: body.sessionId })))
    .filter(event => event.eventName === 'page_viewed' && event.pagePath === '/new-page');
  assert.equal(views.length, 1);
  assert.equal(views[0].sessionId, b.sessionId);
});

test('sensor identity lookup failure stays contained and does not send unsigned events', async () => {
  let requests = 0;
  const page = browser({ fetch: async () => { requests++; return Response.json({}); } });
  const sensors = new page.SensorEngine({ ...config, identity: { visitorId: 'v', sessionId: 's', visitorToken: 't', sessionStartedAt: page.clock.now, returning: false }, getIdentity: async () => { throw new Error('Unavailable'); }, getClientState: () => ({}), onPopup() {} });
  await sensors.send([]);
  assert.equal(requests, 0);
});
