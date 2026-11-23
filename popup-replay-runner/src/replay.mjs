import { chromium, devices } from 'playwright';

export function allowedDestination(value, origin, allowLocalFixture = false) {
  try { const url = new URL(value, origin); return url.origin === origin && (url.protocol === 'https:' || allowLocalFixture && url.protocol === 'http:' && url.hostname === '127.0.0.1') && !url.username && !url.password; } catch { return false; }
}
export function chooseJourneyLinks(links, origin, scenario, allowLocalFixture = false) {
  const clean = links.filter(link => allowedDestination(link.href, origin, allowLocalFixture) && !/logout|delete|checkout|payment|unsubscribe/i.test(link.href));
  const patterns = { pricing: /pricing|fees|plans|cost/i, research: /practice|services|programs|treatments/i, comparison: /programs|services|practice|treatments/i, trust: /reviews|testimonials|about|team|faq/i, form_pause: /consultation|appointment|contact|booking/i, typing: /consultation|appointment|contact|booking/i };
  const preferred = clean.filter(link => (patterns[scenario] ?? patterns.research).test(link.href + ' ' + link.text));
  return [...new Map([...preferred, ...clean].map(link => [link.href, link])).values()].slice(0, 12);
}

/** Actual browser input only. No fake events, forced confidence, clock overrides,
 * navigator.webdriver spoofing, or direct calls into the widget internals. */
export async function executeReplay(job, { backendUrl, heartbeat, signal, headed = false, browserFactory = chromium, allowLocalFixture = false } = {}) {
  const base = new URL(backendUrl), site = new URL(job.websiteUrl);
  if (!allowedDestination(site.href, site.origin, allowLocalFixture)) throw Error('A public HTTPS site is required.');
  const browser = await browserFactory.launch({ headless: !headed });
  const context = await browser.newContext(job.surface === 'mobile' ? { ...devices['iPhone 13'] } : { viewport: { width: 1365, height: 900 } }).catch(async error => { await browser.close(); throw error; });
  const page = await context.newPage().catch(async error => { await browser.close(); throw error; });
  const steps = [], began = Date.now(); let timer, pulse, backgroundPage, artifact, session, failure;
  const log = (action, path) => steps.push({ action, ...(path ? { path: new URL(path, site).pathname.slice(0, 300) } : {}), atMs: Math.min(180000, Date.now() - began) });
  const close = () => { void context.close().catch(() => {}); };
  const abort = () => { failure = 'Run stopped or runner disconnected'; close(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    timer = setTimeout(() => { failure = 'Journey deadline exceeded'; close(); }, job.timeoutMs ?? 120000);
    pulse = setInterval(() => { void heartbeat?.().catch(() => { failure = 'Run expired, stopped or budget exhausted'; close(); }); }, 6000);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === base.origin) {
        if (request.method() === 'GET' && url.pathname === '/widget.js') return route.continue();
        if (request.method() === 'OPTIONS') return route.continue();
        if (request.method() === 'POST' && ['/widget/session', '/events', '/popup/lifecycle', '/analytics/events'].includes(url.pathname)) {
          let body; try { body = request.postDataJSON(); } catch { return route.abort(); }
          if (body.siteId !== job.siteId) return route.fulfill({ status: 403, body: '{}' });
          return route.continue({ headers: { ...request.headers(), 'x-popup-replay': `${job.id}.${job.runToken}` } });
        }
        return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"replay_scope"}' });
      }
      // Browsing never submits a booking/contact form or writes to another app.
      if (!['GET', 'HEAD'].includes(request.method())) return route.fulfill({ status: 204, body: '' });
      if (request.isNavigationRequest() && url.origin !== site.origin) return route.abort();
      return route.continue();
    });
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== base.origin || !['/widget/session', '/events'].includes(url.pathname)) return;
      void response.json().then(body => {
        if (url.pathname === '/widget/session' && body.visitorId) {
          if (session && (session.visitorId !== body.visitorId || session.sessionId !== body.sessionId)) failure = 'Identity changed within one journey';
          session = body;
        }
        if (body.popup) artifact = body.popup;
      }).catch(() => {});
    });
    await page.goto(site.href, { waitUntil: 'domcontentloaded', timeout: 30000 }); log('Open website', site.href);
    await page.locator('#ai-revenue-employee').waitFor({ state: 'attached', timeout: 20000 });
    const identityWait = Date.now(); while (!session && Date.now() - identityWait < 20000 && !signal?.aborted) await page.waitForTimeout(250);
    if (!session) throw Error('Widget did not establish a fresh test identity.');
    if (await context.cookies().then(cookies => cookies.some(cookie => /session/i.test(cookie.name) && cookie.domain === base.hostname))) throw Error('Owner authentication leaked into visitor context.');
    const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => ({ href: node.href, text: (node.textContent ?? '').trim().slice(0, 100) })));
    const journey = chooseJourneyLinks(links, site.origin, job.scenario, allowLocalFixture);
    const popup = page.locator('#ai-revenue-employee .aire-popup');
    const shown = () => popup.isVisible().catch(() => false);
    const attention = async () => {
      await page.mouse.wheel(0, 280); await page.waitForTimeout(450);
      const box = await page.locator('main').first().boundingBox().catch(() => null);
      const x = Math.max(50, Math.min((box?.x ?? 0) + 120, (job.surface === 'mobile' ? 390 : 1365) - 30));
      await page.mouse.move(x, 320); await page.waitForTimeout(1100 + job.ordinal % 3 * 170); await page.mouse.move(x + 5, 325);
      log('Read the visible section', page.url());
    };
    const navigate = async href => { await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 }); log('Navigate', href); await page.waitForTimeout(1200); };
    if (job.scenario === 'chat_open') {
      await page.locator('#ai-revenue-employee .aire-launcher').click(); log('Open chat');
      await attention();
    } else if (job.scenario === 'hidden') {
      backgroundPage = await context.newPage(); await backgroundPage.goto('about:blank'); await backgroundPage.bringToFront();
      await page.waitForTimeout(1000);
      const visibility = await page.evaluate(() => document.visibilityState);
      if (visibility !== 'hidden') throw Error('This browser mode could not produce a genuinely hidden tab. Use --headed.');
      log('Hide website tab');
    } else if (['form_pause', 'typing'].includes(job.scenario)) {
      const link = journey.find(item => /consultation|appointment|contact|booking/i.test(item.href + item.text));
      if (link) await navigate(link.href);
      const field = page.locator('input[type="text"]:not([autocomplete^="cc-"]),input:not([type]),textarea').filter({ visible: true }).first();
      await field.waitFor({ state: 'visible', timeout: 8000 }); await field.click();
      await field.pressSequentially('Replay test', { delay: 220 }); log('Start a form with synthetic text');
      if (job.scenario === 'typing') {
        for (let index = 0; index < 14; index++) { await field.pressSequentially(' ', { delay: 100 }); await page.waitForTimeout(500); }
        log('Continue typing');
      } else {
        for (let index = 0; index < 11; index++) { await page.waitForTimeout(1000); await page.mouse.move(30 + index, 90); }
        log('Pause input while remaining on the page');
      }
    } else {
      if (journey[0]) await navigate(journey[0].href);
      await attention();
      await page.waitForTimeout(4200);
      if (!await shown() && journey[1]) { await navigate(journey[1].href); await attention(); }
      if (!await shown() && journey[0]) { await navigate(journey[0].href); await attention(); log('Revisit the first topic'); }
    }
    const silence = ['chat_open', 'typing', 'hidden'].includes(job.scenario);
    const deadline = Date.now() + (silence ? 7000 : 20000);
    while (!await shown() && Date.now() < deadline && !failure && !signal?.aborted) {
      await page.waitForTimeout(900);
      if (job.scenario === 'typing') await page.locator('input:focus,textarea:focus').pressSequentially(' ', { delay: 150 });
      if (!silence && job.scenario !== 'form_pause') await page.mouse.move(100 + Date.now() % 7, 320);
    }
    if (failure || signal?.aborted) throw Error(failure ?? 'Stopped');
    if (!session) throw Error('Fresh identity missing.');
    if (await shown()) {
      const title = (await popup.locator('.aire-popup__title').textContent())?.trim() ?? '';
      const body = (await popup.locator('.aire-popup__msg').textContent())?.trim() ?? '';
      const cta = (await popup.locator('.aire-popup__cta').first().textContent().catch(() => ''))?.replace(/\s+/g, ' ').trim() ?? '';
      const type = await popup.getAttribute('data-popup-type') ?? '';
      const screenshot = await popup.screenshot({ type: 'jpeg', quality: 65 });
      const action = artifact?.action;
      let destination;
      if (action?.destinationType === 'URL') { const url = new URL(action.destination); if (url.protocol === 'https:' && !url.username && !url.password) destination = url.href; }
      log('Capture actual displayed popup');
      return { result: { outcome: 'displayed', steps, popup: { title, body, type, cta, ...(destination ? { destination } : {}) }, targetCheck: action ? 'Configured destination recorded; no booking submitted' : 'No action returned' }, screenshot: screenshot.toString('base64'), identity: { visitorId: session.visitorId, sessionId: session.sessionId } };
    }
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 45, fullPage: false }).catch(() => undefined);
    return { result: { outcome: 'silent', reason: 'No popup displayed; inspect server decision and safety trace.', steps }, ...(screenshot && screenshot.length <= 400000 ? { screenshot: screenshot.toString('base64') } : {}), identity: { visitorId: session.visitorId, sessionId: session.sessionId } };
  } catch (error) {
    return { result: { outcome: 'failed', reason: failure ?? String(error.message ?? 'Browser journey failed').slice(0, 500), steps } };
  } finally {
    clearTimeout(timer); clearInterval(pulse); signal?.removeEventListener('abort', abort);
    await context.close().catch(() => {}); await browser.close().catch(() => {});
  }
}
