import assert from 'node:assert/strict';
import test from 'node:test';
import { browser, config, identityServer, lockManager, storage } from './runtime.mjs';

test('separate tabs preserve the visitor but obtain different signed sessions', async () => {
  const local = storage();
  const server = identityServer();
  const first = browser({ local, fetch: server.fetch });
  const second = browser({ local, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  const b = await new second.ApiClient(config).getIdentity();
  assert.equal(b.visitorId, a.visitorId);
  assert.notEqual(b.sessionId, a.sessionId);
  assert.equal(server.calls.length, 2);
  assert.equal(a.returning, false);
  assert.equal(b.returning, true);
});

test('reload/navigation keeps the signed session, returning flag and clock origin', async () => {
  const local = storage(), session = storage(), clock = { now: 1_800_000_000_000 };
  const server = identityServer(clock);
  const first = browser({ local, session, clock, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  clock.now += 60_000;
  const next = browser({ local, session, clock, fetch: server.fetch });
  const b = await new next.ApiClient(config).getIdentity();
  assert.equal(b.sessionId, a.sessionId);
  assert.equal(b.sessionStartedAt, a.sessionStartedAt);
  assert.equal(b.returning, false);
  assert.equal(server.calls.length, 1);
  assert.equal(JSON.parse(local.getItem(`aire_widget_visitor_v2:${config.backendUrl}:${config.siteId}`)).sessionId, undefined);
});

for (const [name, elapsed] of [['idle', 30 * 60_000], ['six-hour age', 6 * 60 * 60_000]]) {
  test(`a ${name} tab cache starts a fresh visit on the next document`, async () => {
    const local = storage(), session = storage(), clock = { now: 1_800_000_000_000 };
    const server = identityServer(clock);
    const first = browser({ local, session, clock, fetch: server.fetch });
    const a = await new first.ApiClient(config).getIdentity();
    clock.now += elapsed;
    // Recent activity does not remove the absolute six-hour clock bound.
    if (name === 'six-hour age') first.touchWidgetSession(config, a);
    const next = browser({ local, session, clock, fetch: server.fetch });
    const b = await new next.ApiClient(config).getIdentity();
    assert.equal(b.visitorId, a.visitorId);
    assert.notEqual(b.sessionId, a.sessionId);
    assert.equal(b.sessionStartedAt, clock.now);
    assert.equal(b.expiresAt, a.expiresAt);
    assert.equal(b.returning, true);
  });
}

test('sensor activity keeps a tab visit reusable on navigation', async () => {
  const local = storage(), session = storage(), clock = { now: 1_800_000_000_000 };
  const server = identityServer(clock);
  const first = browser({ local, session, clock, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  clock.now += 29 * 60_000;
  first.touchWidgetSession(config, a);
  clock.now += 2 * 60_000;
  const next = browser({ local, session, clock, fetch: server.fetch });
  assert.equal((await new next.ApiClient(config).getIdentity()).sessionId, a.sessionId);
});

test('legacy 30-day cache is ownership proof only and gets a new session', async () => {
  const server = identityServer();
  const old = await (await server.fetch('', { body: JSON.stringify({ siteId: config.siteId }) })).json();
  const local = storage([[`aire_widget_identity:${config.siteId}`, JSON.stringify(old)]]);
  const page = browser({ local, fetch: server.fetch });
  const current = await new page.ApiClient(config).getIdentity();
  assert.equal(current.visitorId, old.visitorId);
  assert.notEqual(current.sessionId, old.sessionId);
  assert.equal(server.calls[1].visitorToken, old.visitorToken);
  assert.equal(current.returning, true);
});

test('expired visitor proof creates a fresh visitor rather than extending retention', async () => {
  const local = storage(), session = storage(), clock = { now: 1_800_000_000_000 };
  const server = identityServer(clock);
  const first = browser({ local, session, clock, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  clock.now = a.expiresAt;
  const next = browser({ local, session, clock, fetch: server.fetch });
  const b = await new next.ApiClient(config).getIdentity();
  assert.notEqual(b.visitorId, a.visitorId);
  assert.equal(b.returning, false);
  assert.equal(server.calls[1].visitorToken, undefined);
});

test('concurrent transports and API clients in one document share one bootstrap', async () => {
  const server = identityServer();
  const page = browser({ fetch: server.fetch });
  const one = new page.ApiClient(config), two = new page.ApiClient(config);
  const identities = await Promise.all([one.getIdentity(), one.getIdentity(), two.getIdentity()]);
  assert.equal(new Set(identities.map(value => value.sessionId)).size, 1);
  assert.equal(server.calls.length, 1);
});

test('site and backend scopes cannot reuse another widget session', async () => {
  const server = identityServer();
  const page = browser({ fetch: server.fetch });
  const results = await Promise.all([
    new page.ApiClient(config).getIdentity(),
    new page.ApiClient({ ...config, siteId: 'site-b' }).getIdentity(),
    new page.ApiClient({ ...config, backendUrl: 'https://other.test' }).getIdentity(),
  ]);
  assert.equal(new Set(results.map(value => value.sessionId)).size, 3);
  assert.equal(new Set(results.map(value => value.visitorId)).size, 3);
});

for (const operation of ['getItem', 'setItem']) {
  test(`blocked storage ${operation} degrades to a shared per-document identity`, async () => {
    const blocked = () => { throw new Error('Storage blocked'); };
    const local = { ...storage(), [operation]: blocked }, session = { ...storage(), [operation]: blocked };
    const server = identityServer();
    const page = browser({ local, session, fetch: server.fetch });
    const a = await new page.ApiClient(config).getIdentity();
    const b = await new page.ApiClient(config).getIdentity();
    assert.ok(a);
    assert.equal(b.sessionId, a.sessionId);
    assert.equal(server.calls.length, 1);
  });
}

test('throwing storage getters do not prevent bootstrap', async () => {
  const server = identityServer();
  const page = browser({ fetch: server.fetch });
  for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(page.context, key, { get() { throw new Error('Denied'); } });
  assert.ok(await new page.ApiClient(config).getIdentity());
});

test('corrupt stored JSON is ignored and failed bootstrap can recover', async () => {
  const local = storage([[`aire_widget_identity:${config.siteId}`, '{broken']]);
  const server = identityServer();
  let attempts = 0;
  const page = browser({ local, fetch: (...args) => ++attempts === 1 ? Promise.resolve(new Response('{}', { status: 503 })) : server.fetch(...args) });
  const api = new page.ApiClient(config);
  assert.equal(await api.getIdentity(), null);
  page.clock.now += 500; // F05: transient failures share a bounded retry backoff.
  assert.ok(await api.getIdentity());
  assert.equal(attempts, 2);
});

for (const body of [null, {}, { visitorId: 'v', sessionId: 's', visitorToken: 't', expiresAt: 'tomorrow' }]) {
  test(`malformed bootstrap response is rejected: ${JSON.stringify(body)}`, async () => {
    const page = browser({ fetch: async () => Response.json(body) });
    assert.equal(await new page.ApiClient(config).getIdentity(), null);
  });
}

test('copied tab storage cannot reuse an active session when Web Locks are available', async () => {
  const local = storage(), session = storage(), locks = lockManager(), server = identityServer();
  const first = browser({ local, session, locks, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  const clone = browser({ local, session: storage(session.entries()), locks, fetch: server.fetch });
  const b = await new clone.ApiClient(config).getIdentity();
  assert.equal(b.visitorId, a.visitorId);
  assert.notEqual(b.sessionId, a.sessionId);
  first.dispatch('pagehide');
  clone.dispatch('pagehide');
});

test('pagehide releases the tab claim so navigation can reuse the session', async () => {
  const local = storage(), session = storage(), locks = lockManager(), server = identityServer();
  const first = browser({ local, session, locks, fetch: server.fetch });
  const a = await new first.ApiClient(config).getIdentity();
  first.dispatch('pagehide');
  await new Promise(resolve => setTimeout(resolve, 0));
  const next = browser({ local, session, locks, fetch: server.fetch });
  assert.equal((await new next.ApiClient(config).getIdentity()).sessionId, a.sessionId);
  next.dispatch('pagehide');
});

for (const elapsed of [30 * 60_000, 6 * 60 * 60_000]) {
  test(`an open document renews a stale visit before transport after ${elapsed}ms`, async () => {
    const clock = { now: 1_800_000_000_000 }, server = identityServer(clock), changes = [];
    const page = browser({ clock, fetch: server.fetch });
    const api = new page.ApiClient(config, identity => changes.push(identity.sessionId));
    const a = await api.getIdentity();
    clock.now += elapsed;
    if (elapsed > 30 * 60_000) page.touchWidgetSession(config, a);
    const [b, c] = await Promise.all([api.getIdentity(), api.getIdentity()]);
    assert.equal(b.visitorId, a.visitorId);
    assert.notEqual(b.sessionId, a.sessionId);
    assert.equal(b.sessionId, c.sessionId);
    assert.deepEqual(changes, [b.sessionId]);
    assert.equal(server.calls.length, 2);
  });
}

test('simultaneous first visits share visitor ownership when Web Locks are available', async () => {
  const local = storage(), locks = lockManager(), server = identityServer();
  const first = browser({ local, locks, fetch: server.fetch });
  const second = browser({ local, locks, fetch: server.fetch });
  const [a, b] = await Promise.all([new first.ApiClient(config).getIdentity(), new second.ApiClient(config).getIdentity()]);
  assert.equal(a.visitorId, b.visitorId);
  assert.notEqual(a.sessionId, b.sessionId);
  first.dispatch('pagehide'); second.dispatch('pagehide');
});

test('denied Web Locks degrade to usable tab storage rather than disabling the widget', async () => {
  const server = identityServer();
  const page = browser({ locks: { async request() { throw new Error('Denied'); } }, fetch: server.fetch });
  assert.ok(await new page.ApiClient(config).getIdentity());
  assert.equal(server.calls.length, 1);
});

test('failed live renewal cannot be revived by a late analytics touch', async () => {
  const clock = { now: 1_800_000_000_000 }, server = identityServer(clock);
  let fail = false;
  const page = browser({ clock, fetch: (...args) => fail ? Promise.resolve(new Response('{}', { status: 503 })) : server.fetch(...args) });
  const api = new page.ApiClient(config);
  const a = await api.getIdentity();
  clock.now += 30 * 60_000;
  fail = true;
  assert.equal(await api.getIdentity(), null);
  page.touchWidgetSession(config, a);
  fail = false;
  clock.now += 500;
  const b = await api.getIdentity();
  assert.notEqual(b.sessionId, a.sessionId);
});
