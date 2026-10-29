import { build } from 'esbuild';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  stdin: {
    contents: `export { ApiClient } from './src/api/client.ts';
      export { SessionManager } from './src/session/state.ts';
      export { EventEmitter } from './src/sensors/emitter.ts';
      export { SensorEngine } from './src/sensors/index.ts';
      export { AnalyticsTracker } from './src/analytics/analytics.ts';
      export { Orchestrator } from './src/core/orchestrator.ts';
      export { InterruptionSafety } from './src/core/interruptionSafety.ts';
      export { PopupDelivery } from './src/popup/delivery.ts';
      export { ChatWindow } from './src/chat/chat.ts';
      export { asksForLeadEmail } from './src/chat/leadLanguage.ts';
      export { touchWidgetSession } from './src/session/identity.ts';`,
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
  },
  bundle: true, write: false, format: 'iife', globalName: 'WidgetTest', platform: 'browser', target: 'es2020',
});

export function storage(initial = []) {
  const values = new Map(initial);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    entries: () => [...values.entries()],
  };
}

export const config = { siteId: 'site-a', backendUrl: 'https://backend.test', debug: false };

export function browser({ local = storage(), session = storage(), fetch, clock = { now: 1_800_000_000_000 }, locks, timers } = {}) {
  const events = new Map();
  const window = {
    setTimeout: timers?.setTimeout ?? ((fn, ms) => { const timer = setTimeout(fn, ms); timer.unref(); return timer; }), clearTimeout: timers?.clearTimeout ?? clearTimeout,
    location: { href: 'https://customer.test/pricing', pathname: '/pricing', search: '', hash: '' },
    innerWidth: 1280, matchMedia: () => ({ matches: false }),
    addEventListener(name, handler) { const handlers = events.get(name) ?? new Set(); handlers.add(handler); events.set(name, handlers); },
    removeEventListener(name, handler) { events.get(name)?.delete(handler); },
  };
  const context = vm.createContext({
    window, document: { ...window, visibilityState: 'visible', title: 'Pricing', referrer: '' }, navigator: { locks, userAgent: 'Test Browser' },
    localStorage: local, sessionStorage: session, fetch, crypto: webcrypto,
    Date: class extends Date { static now() { return clock.now; } },
    history: {
      pushState(_state, _title, path) { window.location.pathname = String(path); },
      replaceState(_state, _title, path) { window.location.pathname = String(path); },
    },
    setTimeout, clearTimeout, setInterval, clearInterval, AbortController, URLSearchParams, TextDecoder, console,
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  return { ...context.WidgetTest, context, local, session, clock, dispatch: (name, detail = {}) => { for (const fn of events.get(name) ?? []) fn({ type: name, persisted: false, ...detail }); } };
}

export function scheduler(clock) {
  let nextId = 0;
  const tasks = new Map();
  return {
    setTimeout(fn, ms) { const id = ++nextId; tasks.set(id, { fn, at: clock.now + ms }); return id; },
    clearTimeout(id) { tasks.delete(id); },
    async advance(ms) {
      await new Promise(resolve => setTimeout(resolve, 0));
      const target = clock.now + ms;
      for (let guard = 0; guard < 1000; guard++) {
        const next = [...tasks].filter(([, task]) => task.at <= target).sort((a,b) => a[1].at-b[1].at)[0];
        if (!next) { clock.now = target; await new Promise(resolve => setTimeout(resolve, 0)); return; }
        clock.now = next[1].at; tasks.delete(next[0]); next[1].fn();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      throw new Error('Unbounded timer loop');
    },
  };
}

export function identityServer(clock = { now: 1_800_000_000_000 }) {
  let counter = 0;
  const issued = new Map();
  const calls = [];
  const fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const previous = issued.get(body.visitorToken);
    const visitorId = previous?.visitorId ?? `visitor-${++counter}`;
    const result = { visitorId, sessionId: `session-${++counter}`, visitorToken: `token-${counter}`, expiresAt: previous?.expiresAt ?? clock.now + 30 * 24 * 60 * 60 * 1000 };
    issued.set(result.visitorToken, result);
    return Response.json(result, { status: 201 });
  };
  return { fetch, calls, issued };
}

export function lockManager() {
  const held = new Set();
  return {
    async request(name, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      if (options.ifAvailable && held.has(name)) return callback(null);
      while (held.has(name)) await new Promise(resolve => setTimeout(resolve, 0));
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    },
  };
}
