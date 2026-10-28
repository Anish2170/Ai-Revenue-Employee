import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';

// Isolated test process: synthetic credentials, no database and no external HTTP.
process.env.DATABASE_URL = '';
process.env.OPENAI_API_KEY = 'phase2-unit-test';
process.env.GEMINI_API_KEY = 'phase2-unit-test';
process.env.DEBUG_TRACE = 'false';
const { ingestEvents } = await import('../services/perceptionService.js');
const { sessionStore } = await import('../intelligence/session/visitorSession.js');
const { eventsRouter } = await import('../routes/events.js');
const { issuePublicWidgetIdentity } = await import('./publicIdentity.js');
const { getVectorStore } = await import('../vectorstore/index.js');
const { __setProvidersForTests } = await import('../llm/index.js');
const { generatePopupLanguage } = await import('../intelligence/popupLlmAdapter.js');
const { popupJsonSchema } = await import('../validation/popupSchema.js');

const events = [
  { type: 'content_dwell', zone: 'pricing', intensity: 0.9, ts: 10_000 },
  { type: 'pricing_focus', zone: 'pricing', intensity: 0.9, ts: 25_000 },
  { type: 'zone_revisit', zone: 'pricing', intensity: 0.9, ts: 60_000 },
];

test('F06 reproduction: current typing must override strong previous pricing intent', t => {
  const siteId = 'phase2-safety';
  t.after(() => sessionStore.deleteSite(siteId));
  const result = ingestEvents({ siteId, sessionId: 'phase2-typing', returning: false, surface: 'desktop', rawEvents: events,
    clientState: { safety: { blockedReason: 'typing', version: 2, formStalled: false } } as never });
  assert.equal(result.shadowDecision?.action, 'silent');
  assert.equal(result.shadowDecision?.suppressedBy, 'typing');
});

test('F07 reproduction: overlapping eligible requests reserve one generation and no display budget', async t => {
  const { identity, token } = issuePublicWidgetIdentity('phase2-concurrent');
  t.after(() => sessionStore.deleteSite(identity.siteId));
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const provider = { id: 'mock', streamText: async function* () {}, embed: async () => [[1, 0]],
    async generateStructured() { calls++; await gate; return { title: 'Need help?', body: 'Our team can help with your questions.', primaryAction: '', secondaryAction: '', tone: 'reassuring', popupType: 'trust' }; } };
  __setProvidersForTests(provider, provider);
  t.after(() => __setProvidersForTests(null, null));
  const store = getVectorStore();
  const original = store.export();
  store.import([{ id: 'test', url: '/about', page: '/about', pageType: 'about', section: 'team', heading: 'Team', title: 'Team', language: 'English', hash: 'test', lastCrawled: new Date().toISOString(), content: 'Our team can help with your questions.', embedding: [1, 0] }]);
  t.after(() => store.import(original));
  t.mock.method(globalThis, 'fetch', async (...[url]: Parameters<typeof fetch>) => {
    assert.match(String(url), /generativelanguage\.googleapis\.com/);
    return Response.json({ embeddings: [{ values: [1, 0] }] });
  });
  const body = { siteId: identity.siteId, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: token,
    pageInstanceId: '00000000-0000-4000-8000-000000000001', lifecycleVersion: 2,
    clientState: { safety: { blockedReason: null, version: 0, formStalled: false } },
    events: [
      { type: 'content_dwell', zone: 'trust', intensity: 0.9, ts: 15_000 },
      { type: 'content_dwell', zone: 'faq', intensity: 0.85, ts: 25_000 },
      { type: 'zone_revisit', zone: 'trust', intensity: 0.9, ts: 38_000 },
      { type: 'content_dwell', zone: 'trust', intensity: 0.9, ts: 47_000 },
    ] };
  // Run the actual signed route handler without opening host/sandbox sockets.
  const handler = eventsRouter.stack.find((layer: any) => layer.route?.path === '/events')!.route!.stack.at(-1)!.handle;
  const send = async (offset: number) => {
    let reply: unknown;
    const req = Object.assign(new EventEmitter(), { body: { ...body, events: body.events.map(e => ({ ...e, ts: e.ts + offset })) }, query: {}, get: () => undefined });
    const res = Object.assign(new EventEmitter(), { writableEnded: false, json(value: unknown) { reply = value; this.writableEnded = true; return this; } });
    await handler(req as never, res as never, () => {});
    return reply;
  };
  const first = send(0);
  for (let i = 0; i < 100 && calls === 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const second = send(1000);
  await new Promise(resolve => setTimeout(resolve, 30));
  release();
  const replies = await Promise.all([first, second]) as Array<{ popup?: { delivery?: { popupId: string } } }>;
  assert.equal(calls, 1, 'one session must not start two simultaneous generations');
  assert.equal(sessionStore.get(identity.sessionId)?.priorInterruptions, 0, 'generation is not verified display');
  assert.equal(replies.filter(reply => reply.popup?.delivery?.popupId).length, 1, 'one validated candidate must reach the response');
});

test('F14 reproduction: wrapper timeout must abort the actual provider signal', async () => {
  let signal: AbortSignal | undefined;
  const result = await generatePopupLanguage({ prompt: { version: 'popup-v1', system: 'Test', user: 'Test', schema: popupJsonSchema, sections: [] }, safety: { ok: true, reasons: [], checked: { salesBrainSpeak: true, confidenceOk: true, strategyOk: true, knowledgeOk: true, ctaOk: true, businessPolicyOk: true } } },
    { available: () => true, timeoutMs: 5, generateStructured: req => { signal = (req as typeof req & { signal?: AbortSignal }).signal; return new Promise(() => {}); } });
  assert.equal(result.ok, false);
  assert.equal(signal?.aborted, true);
});
