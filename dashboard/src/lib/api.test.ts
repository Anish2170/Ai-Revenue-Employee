import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient } from './api.ts';

const identity = {
  siteId: 'site-test',
  visitorId: 'visitor-issued-by-backend',
  sessionId: 'session-issued-by-backend',
  visitorToken: 'visitor-token-issued-by-backend',
  expiresAt: 1_800_000_000,
};

test('knowledge polling delivers changed counters in the same phase and stops after completion', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const scheduled: Array<() => void> = [];
  // Run poll timers deterministically; request deadlines are cleared before firing.
  globalThis.window = { location: { protocol: 'http:', hostname: 'localhost' },
    setTimeout: (fn: () => void, ms: number) => { if (ms < 15000) scheduled.push(fn); return 1; },
    clearTimeout: () => {},
  } as unknown as Window & typeof globalThis;
  let polls = 0;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith('/auth/csrf')) return Response.json({ csrfToken: 'test' });
    if (url.endsWith('/knowledge/build')) return Response.json({ buildId: 'build-test' });
    polls++;
    return Response.json({ status: polls === 3 ? 'SUCCESS' : 'RUNNING', phase: polls === 3 ? 'complete' : 'action_discovery', progress: { actionsCompleted: polls * 2, actionsTotal: 6 } });
  };
  try {
    const updates: number[] = [];
    let complete = false;
    const finished = new Promise<void>((resolve, reject) => {
      new ApiClient().buildKnowledge('site', 'https://example.test')
        .onPhase((_phase, data) => { updates.push((data as { actionsCompleted: number }).actionsCompleted); })
        .onComplete(() => { complete = true; resolve(); }).onError(reject).start();
    });
    for (let i = 0; i < 30 && !complete; i++) {
      await new Promise(resolve => setImmediate(resolve));
      scheduled.shift()?.();
    }
    await finished;
    assert.deepEqual(updates, [2, 4, 6]);
    assert.equal(polls, 3);
    assert.equal(scheduled.length, 0);
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});

function sseResponse(): Response {
  return new Response('data: {"token":"Hello"}\n\ndata: [DONE]\n\n', { status: 200 });
}

test('Test AI bootstraps, retains, and forwards the complete widget identity unchanged', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith('/widget/session')) return Response.json(identity, { status: 201 });
    if (url.endsWith('/chat')) return sseResponse();
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const client = new ApiClient();
    const messages = [{ role: 'user' as const, content: 'What do you offer?' }];
    await client.sendTestChat(identity.siteId, messages);
    await client.sendTestChat(identity.siteId, messages);

    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], { url: 'http://localhost:8787/widget/session', body: { siteId: identity.siteId } });
    assert.deepEqual(calls[1].body, {
      siteId: identity.siteId,
      visitorId: identity.visitorId,
      sessionId: identity.sessionId,
      visitorToken: identity.visitorToken,
      messages,
      behaviour: {
        page: '/onboarding-test',
        pageTitle: 'Owner onboarding test chat',
        timeOnPage: 0,
        scrollDepth: 0,
        mouseInactive: 0,
        clickedElements: [],
        formInteracted: false,
        viewport: { width: 1280, height: 800 },
        exitIntent: false,
      },
    });
    assert.equal(calls[2].url, 'http://localhost:8787/chat');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Test AI does not call chat when widget session bootstrap fails', async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ error: 'TENANT_NOT_FOUND' }, { status: 404 });
  };

  try {
    await assert.rejects(new ApiClient().sendTestChat(identity.siteId, [{ role: 'user', content: 'Hello' }]));
    assert.deepEqual(calls, ['http://localhost:8787/widget/session']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
