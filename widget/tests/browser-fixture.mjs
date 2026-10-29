// Local-only manual browser fixture. No database, secrets, remote requests or AI.
// Run: node tests/browser-fixture.mjs, then open the printed loopback URL.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const visits = new Map(), attempts = new Map();
const bundle = await build({
  stdin: { contents: `import { Orchestrator } from './src/core/orchestrator.ts';
    const originalNow = Date.now.bind(Date); let offset = 0;
    Date.now = () => originalNow() + offset;
    const caseId = new URLSearchParams(location.search).get('case') || 'normal';
    const app = new Orchestrator({siteId:'fixture-'+caseId,backendUrl:location.origin,debug:false,legacyEngagement:false});
    window.fixture = app; app.start();
    const button = (id, fn) => document.getElementById(id).onclick = fn;
    for (const path of ['home','pricing','services']) button(path, () => history.pushState({}, '', '/'+path+location.search));
    button('back', () => history.back()); button('forward', () => history.forward());
    button('advance', () => offset += 30000);
    button('popup', async () => { if (!app.sensors || !app.identity) return;
      await app.sensors.send([{id:'f03f04f0-0000-4000-8000-'+crypto.randomUUID().slice(-12),type:'pricing_focus',zone:'pricing',intensity:0.9,ts:Date.now()-app.identity.sessionStartedAt,surface:'desktop'}]); });
    button('chat', () => app.openChat());
    setInterval(() => { document.getElementById('state').textContent = JSON.stringify({
      path: location.pathname, visitorId: app.identity?.visitorId, sessionId: app.sessionId,
      sensorsReady:!!app.sensors, chatOpen:!!app.chat?.isOpen, popupVisible:!!app.popup,
      state:app.session?.get(), errors:window.fixtureErrors||[]},null,2); },100);
    window.addEventListener('error', e => (window.fixtureErrors ||= []).push(e.message));
    window.addEventListener('unhandledrejection', e => (window.fixtureErrors ||= []).push(String(e.reason)));
  `, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2018',
});
const script = bundle.outputFiles[0].text;
const html = `<!doctype html><html><head><title>Phase 1 local browser fixture</title></head><body>
  <h1>Phase 1 local browser fixture</h1><p>Mock endpoints; real production widget modules. No AI or database.</p>
  <button id="home">Home SPA</button><button id="pricing">Pricing SPA</button><button id="services">Services SPA</button>
  <button id="back">Back</button><button id="forward">Forward</button>
  <button id="advance">Advance clock 30 seconds</button><button id="popup">Request demo popup</button><button id="chat">Open chat</button>
  <p><a href="/pricing?case=reload">Full-page pricing test</a> | <a href="/home?case=recovery">Initial failure recovery test</a></p>
  <pre id="state" aria-live="polite">Starting...</pre><script src="/fixture.js"></script></body></html>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET') {
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(script); }
    else { res.setHeader('Content-Type','text/html'); res.end(html); }
    return;
  }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || '{}');
  res.setHeader('Content-Type','application/json');
  if (url.pathname === '/widget/session') {
    const count = (attempts.get(body.siteId) || 0) + 1; attempts.set(body.siteId,count);
    if (body.siteId.includes('recovery') && count <= 2) { res.statusCode = 503; res.end('{}'); return; }
    const previous = visits.get(body.visitorToken);
    const value = {visitorId: previous?.visitorId || randomUUID(),sessionId:randomUUID(),visitorToken:randomUUID(),expiresAt:previous?.expiresAt||Date.now()+30*86400000};
    visits.set(value.visitorToken,value); res.statusCode=201; res.end(JSON.stringify(value));
  } else if (url.pathname === '/events') {
    if (!visits.has(body.visitorToken)) { res.end('{}'); return; }
    const requested = body.events?.some(event => event.id?.startsWith('f03f04f0-'));
    res.end(JSON.stringify({status:'ack',...(requested ? {popup:{title:'Fixture help',body:'Local test popup.',tone:'helpful',popupType:'educational'}} : {})}));
  } else if (url.pathname.includes('conversations')) {
    res.end(JSON.stringify({conversation:{id:'fixture-conversation',title:'Local test chat',messages:[]},conversations:[]}));
  } else res.end('{}');
});
server.listen(Number(process.argv[2])||0,'127.0.0.1',()=>console.log(`Local fixture: http://127.0.0.1:${server.address().port}/home`));
