import assert from 'node:assert/strict';
import test from 'node:test';
import { browser, config, identityServer, storage, scheduler } from './runtime.mjs';

test('F04: reload resets page shown flag but preserves dismissal, budget and cooldown', () => {
  const session = storage();
  const first = browser({ session });
  const state = new first.SessionManager(config.siteId);
  state.bind('visit-one'); state.markEngaged(); state.markPopupShown(); state.markDismissed();
  const second = browser({ session });
  const reloaded = new second.SessionManager(config.siteId);
  reloaded.bind('visit-one');
  assert.equal(reloaded.get().popupShown, false);
  assert.equal(reloaded.get().dismissed, true);
  assert.equal(reloaded.get().engageCount, 1);
  assert.equal(reloaded.get().lastEngageAt, first.clock.now);
});

test('F04: page reset must not erase the visitor session dismissal', () => {
  const page = browser();
  const state = new page.SessionManager(config.siteId);
  state.bind('visit-one'); state.markDismissed(); state.resetForPage();
  assert.equal(state.get().dismissed, true);
});

test('F05: storage-blocked live renewal preserves the in-memory signed visitor proof', async () => {
  const clock = { now: 1_800_000_000_000 }, server = identityServer(clock);
  const blocked = { getItem() { throw new Error('Denied'); }, setItem() { throw new Error('Denied'); } };
  const page = browser({ local: blocked, session: blocked, clock, fetch: server.fetch });
  const api = new page.ApiClient(config);
  const first = await api.getIdentity();
  clock.now += 30 * 60_000;
  const next = await api.getIdentity();
  assert.equal(next.visitorId, first.visitorId);
  assert.notEqual(next.sessionId, first.sessionId);
});

test('F05: identity recovery through chat/API also activates the initially disabled transports', async () => {
  const server = identityServer(), pageClock = { now: 1_800_000_000_000 };
  let fail = true, sensorStarts = 0;
  const page = browser({ clock: pageClock, fetch: (...args) => fail ? Promise.resolve(new Response('{}', { status: 503 })) : server.fetch(...args) });
  const app = new page.Orchestrator(config);
  app.session = new page.SessionManager(config.siteId);
  app.api = new page.ApiClient(config, identity => app.renewSession(identity), identity => app.activateIdentity(identity));
  app.startAnalytics = () => {};
  app.startSensors = () => { sensorStarts++; };
  await app.startPublicTransports();
  fail = false;
  pageClock.now += 1000;
  assert.ok(await app.api.getIdentity());
  assert.equal(sensorStarts, 1);
});

test('F04: default startup observes SPA navigation without enabling the legacy Tracker', async () => {
  const server = identityServer(), page = browser({ fetch: server.fetch });
  const app = new page.Orchestrator(config);
  let removed = false;
  app.mountUiShell = () => {
    app.session = new page.SessionManager(config.siteId);
    app.api = new page.ApiClient(config);
  };
  app.startAnalytics = () => {};
  app.startSensors = () => {};
  app.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  app.session.markEngaged(); app.session.markPopupShown();
  app.popup = { remove() { removed = true; } };
  page.context.history.pushState({}, '', '/services');
  assert.equal(app.session.get().popupShown, false);
  assert.equal(app.session.get().engageCount, 1);
  assert.equal(removed, true);
});

function appFixture(page, cfg = config) {
  const app = new page.Orchestrator(cfg);
  const starts = [];
  app.mountUiShell = () => {
    app.session = new page.SessionManager(cfg.siteId);
    app.api = new page.ApiClient(cfg, identity => app.activateIdentity(identity), identity => app.activateIdentity(identity));
  };
  app.startAnalytics = () => {};
  app.startSensors = identity => { starts.push(identity.sessionId); app.sensors = { stop() {}, cancelPending() { return false; }, requestOpportunity() {} }; };
  app.start();
  return { app, starts };
}

test('F05: automatic startup recovery is bounded, then online can start another bounded attempt', async () => {
  const clock = { now: 1_800_000_000_000 }, timers = scheduler(clock), server = identityServer(clock);
  let attempts = 0, fail = true;
  const page = browser({ clock, timers, fetch: (...args) => { attempts++; return fail ? Promise.resolve(new Response('{}', { status:503 })) : server.fetch(...args); } });
  const { starts } = appFixture(page);
  await timers.advance(10_000);
  assert.equal(attempts, 4, 'initial request plus three automatic retries');
  assert.equal(starts.length, 0);
  await timers.advance(60_000);
  assert.equal(attempts, 4, 'no endless background requests');
  fail = false;
  page.dispatch('online');
  await timers.advance(1000);
  assert.equal(attempts, 5);
  assert.equal(starts.length, 1);
});

test('F05: concurrent failing identity calls share a promise and retry backoff', async () => {
  let attempts = 0;
  const page = browser({ fetch: async () => { attempts++; return new Response('{}',{status:503}); } });
  const api = new page.ApiClient(config);
  assert.ok((await Promise.all(Array.from({length:30},()=>api.getIdentity()))).every(value=>value===null));
  await Promise.all(Array.from({length:30},()=>api.getIdentity()));
  assert.equal(attempts,1);
  page.clock.now += 500;
  await api.getIdentity();
  assert.equal(attempts,2);
});

test('F05: a hanging JSON body times out and its late result cannot overwrite recovery', async () => {
  const clock = { now:1_800_000_000_000 }, timers = scheduler(clock), server = identityServer(clock);
  let finishBody, attempts = 0;
  const page = browser({clock,timers,fetch:(...args)=>++attempts===1 ? Promise.resolve({ok:true,json:()=>new Promise(resolve=>{finishBody=resolve;})}) : server.fetch(...args)});
  const api = new page.ApiClient(config);
  const pending = api.getIdentity();
  await timers.advance(10_000);
  assert.equal(await pending,null);
  await timers.advance(500);
  const recovered = await api.getIdentity();
  assert.ok(recovered);
  finishBody({visitorId:'old-visitor',sessionId:'old-session',visitorToken:'old-token',expiresAt:clock.now+100000});
  await timers.advance(0);
  assert.equal((await api.getIdentity()).sessionId,recovered.sessionId);
});

test('F05: blocked Web Locks getters do not block identity networking', async () => {
  const server=identityServer(), page=browser({fetch:server.fetch});
  Object.defineProperty(page.context.navigator,'locks',{get(){throw new Error('Denied');}});
  assert.ok(await new page.ApiClient(config).getIdentity());
});

test('F04: SPA, query/hash, Back/Forward and BFCache changes preserve session dismissal and budget', async () => {
  const server=identityServer(), page=browser({fetch:server.fetch});
  const {app}=appFixture(page);
  await new Promise(resolve=>setTimeout(resolve,0));
  app.session.markEngaged(); app.session.markPopupShown(); app.session.markDismissed();
  const id=app.sessionId;
  for (const path of ['/home','/pricing','/services']) {
    page.context.history.pushState({},'',path);
    assert.equal(app.session.get().popupShown,false);
    assert.equal(app.session.get().dismissed,true);
    assert.equal(app.session.get().engageCount,1);
    assert.equal(app.sessionId,id);
  }
  const before=app.pageVersion;
  page.context.history.replaceState({},'','/services');
  assert.equal(app.pageVersion,before,'same URL is not another page');
  page.context.window.location.search='?plan=business'; page.dispatch('popstate');
  page.context.window.location.hash='#details'; page.dispatch('hashchange');
  page.context.window.location.pathname='/pricing'; page.dispatch('popstate');
  page.dispatch('pageshow',{persisted:true});
  assert.equal(app.pageVersion,before+4);
  assert.equal(app.session.get().dismissed,true);
  assert.equal(app.session.get().engageCount,1);
});

test('F04: navigation keeps chat open and the two-popup budget continues to suppress', async () => {
  const server=identityServer(),page=browser({fetch:server.fetch});
  const {app}=appFixture(page);
  await new Promise(resolve=>setTimeout(resolve,0));
  app.chat={isOpen:true}; app.root={layer:{}};
  app.session.markEngaged(); app.session.markEngaged();
  page.context.history.pushState({},'','/pricing');
  assert.equal(app.chat.isOpen,true);
  app.showPopup({showPopup:true,title:'Should not render',body:'Budget or chat blocks this.'});
  assert.equal(app.popup,null);
  app.chat.isOpen=false;
  page.clock.now+=30_000;
  app.showPopup({showPopup:true,title:'Should not render',body:'Budget still blocks this.'});
  assert.equal(app.popup,null);
  assert.equal(app.session.get().engageCount,2);
});

test('F04: a pending old-page response is ignored even after navigating away and back', async () => {
  const server=identityServer(); let complete, delivered=0;
  const page=browser({fetch:(url,init)=>url.endsWith('/widget/session')?server.fetch(url,init):new Promise(resolve=>{complete=resolve;})});
  const {app}=appFixture(page);
  await new Promise(resolve=>setTimeout(resolve,0));
  const sensors=new page.SensorEngine({...config,identity:app.identity,getIdentity:()=>app.api.getIdentity(),getClientState:()=>({}),onPopup:()=>delivered++});
  app.sensors=sensors;
  await sensors.send([{type:'pricing_focus',zone:'pricing',intensity:0.9,ts:1000,surface:'desktop'}]);
  page.context.history.pushState({},'','/services');
  page.context.history.pushState({},'','/pricing');
  complete(Response.json({popup:{title:'Old',body:'Old page',tone:'helpful',popupType:'educational'}}));
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(delivered,0);
});

test('F03: emitted event IDs are unique while a backward wall-clock change cannot regress timestamps', () => {
  const page=browser(),events=[];
  const emitter=new page.EventEmitter({surface:'desktop',maxBuffer:1,send:batch=>events.push(...batch)});
  page.clock.now+=100_000; emitter.emit('content_dwell','pricing');
  page.clock.now-=50_000; emitter.emit('content_dwell','pricing');
  assert.equal(events[0].ts,100_000); assert.equal(events[1].ts,100_000);
  assert.notEqual(events[0].id,events[1].id);
});

test('F05: identity request timeout is bounded and recovery does not need a new ApiClient', async () => {
  const clock={now:1_800_000_000_000},timers=scheduler(clock),server=identityServer(clock);
  let fail=true;
  const page=browser({clock,timers,fetch:(...args)=>fail?new Promise(()=>{}):server.fetch(...args)});
  const api=new page.ApiClient(config), pending=api.getIdentity();
  await timers.advance(10_000);
  assert.equal(await pending,null);
  fail=false; await timers.advance(500);
  assert.ok(await api.getIdentity());
});

test('F05: signed-token expiry plus temporary renewal failure preserves security and recovers', async () => {
  const clock={now:1_800_000_000_000},server=identityServer(clock);
  let fail=false;
  const page=browser({clock,fetch:(...args)=>fail?Promise.resolve(new Response('{}',{status:503})):server.fetch(...args)});
  const api=new page.ApiClient(config),first=await api.getIdentity();
  clock.now=first.expiresAt; fail=true;
  assert.equal(await api.getIdentity(),null);
  fail=false; clock.now+=500;
  const next=await api.getIdentity();
  assert.notEqual(next.visitorId,first.visitorId);
  assert.notEqual(next.sessionId,first.sessionId);
  assert.equal(server.calls[1].visitorToken,undefined,'expired proof is never renewed as visitor ownership');
});

test('F05: visibility recovery after exhausted retries starts transports once', async () => {
  const clock={now:1_800_000_000_000},timers=scheduler(clock),server=identityServer(clock);
  let fail=true;
  const page=browser({clock,timers,fetch:(...args)=>fail?Promise.resolve(new Response('{}',{status:503})):server.fetch(...args)});
  const {starts}=appFixture(page);
  await timers.advance(10_000);
  fail=false;
  page.context.document.visibilityState='visible'; page.dispatch('visibilitychange');
  await timers.advance(1000);
  assert.equal(starts.length,1);
});
