import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

test('real Chromium journeys use signed fresh identities and real widget signals', { skip: !process.env.REPLAY_TEST_DATABASE_URL, timeout: 240000 }, async () => {
  const target = new URL(process.env.REPLAY_TEST_DATABASE_URL!);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55447');
  assert.equal(target.pathname, '/ai_employee_phase47_test');
  assert.match(target.searchParams.get('schema') ?? '', /^popup_replay_\d{8}$/);
  const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
  const dir = await mkdtemp(join(root, 'release-verification/popup-replay-build-20261107/browser-'));
  process.env.DATABASE_URL = target.href; process.env.NODE_ENV = 'test';
  process.env.KNOWLEDGE_DIR = dir; process.env.DEBUG_TRACE = 'false';
  process.env.OPENAI_API_KEY = ''; process.env.GEMINI_API_KEY = 'local-fixture-only';
  const originalFetch = globalThis.fetch;
  let embeddingStubs = 0, generationStubs = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname === 'generativelanguage.googleapis.com') { embeddingStubs++; return Response.json({ embeddings: [{ values: [1, 0] }] }); }
    if (url.hostname === '127.0.0.1') return originalFetch(input, init);
    throw Error('Browser fixture forbids external HTTP');
  };
  const { prisma } = await import('../db/prisma.js');
  const service = await import('./service.js');
  const { replayWidgetMiddleware } = await import('./middleware.js');
  const { publicIdentityRouter } = await import('../widget/publicIdentity.routes.js');
  const { eventsRouter } = await import('../routes/events.js');
  const { __setProvidersForTests } = await import('../llm/index.js');
  __setProvidersForTests({ id: 'openai:gpt-6-luna', generateStructured: async req => {
    generationStubs++; assert.ok((req.maxOutputTokens ?? Infinity) <= 512);
    return { title: 'Questions about legal fees?', body: 'What would you like to understand about legal fees?', tone: 'reassuring', popupType: 'pricing', primaryAction: 'pricing' };
  }, streamText: async function* () { throw Error('No chat in browser fixture'); }, embed: async () => { throw Error('Use the embedding HTTP stub'); } }, null);
  const build = createRequire(new URL('../../../widget/package.json', import.meta.url))('esbuild').build;
  const bundle = await build({ entryPoints: [join(root, 'widget/src/index.ts')], bundle: true, write: false, format: 'iife', platform: 'browser' });
  const api = express(); api.use(express.json());
  api.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', req.get('origin') ?? '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Popup-Replay'); if (req.method === 'OPTIONS') return void res.sendStatus(204); next(); });
  api.get('/widget.js', (_req, res) => res.type('js').send(bundle.outputFiles[0].text));
  api.use(replayWidgetMiddleware, publicIdentityRouter, eventsRouter);
  const apiServer = api.listen(0, '127.0.0.1'); await new Promise<void>(r => apiServer.once('listening', r));
  const backendUrl = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`;
  const org = await prisma.organization.create({ data: { name: 'Browser replay fixture', slug: randomUUID() } });
  const siteId = randomUUID();
  const site = await prisma.website.create({ data: { organizationId: org.id, name: 'Local Lexora Law', url: 'https://8.8.8.8', widget: { create: { siteId, widgetPublicKey: randomUUID() } } } });
  const html = express();
  html.get('*', (req, res) => res.type('html').send(`<!doctype html><html><head><title>Lexora Law</title><style>body{margin:0;font:18px system-ui}header{height:80px}section{min-height:700px;padding:30px}nav a{margin:20px}input{padding:16px}</style></head><body><header><nav><a href="/fees">Legal fees</a><a href="/practice-areas">Practice Areas</a><a href="/consultation">Consultation</a></nav></header><main><section id="pricing"><h1>Legal consultation pricing</h1><p>Understand our consultation fees and legal services.</p><a href="/fees">View pricing</a></section><section id="services"><h2>Practice areas</h2><p>Property and family law guidance.</p><form><label>Your question<input type="text"></label></form></section></main><script src="${backendUrl}/widget.js" data-site-id="${siteId}" data-backend="${backendUrl}"></script></body></html>`));
  const siteServer = html.listen(0, '127.0.0.1'); await new Promise<void>(r => siteServer.once('listening', r));
  const websiteUrl = `http://127.0.0.1:${(siteServer.address() as { port: number }).port}`;
  try {
    const paired = await service.createRunner(org.id, randomUUID(), 'Browser fixture');
    const creds = await service.pairRunner(paired.pairingCode); const runner = await service.authenticateRunner(creds.token);
    const batch = await service.createBatch(org.id, randomUUID(), { websiteId: site.id, runnerId: runner.id, count: 3, scenarios: ['pricing', 'chat_open', 'typing'], surface: 'desktop', budgetMicros: 1000000 });
    await prisma.popupReplayRun.updateMany({ where: { batchId: batch.id, ordinal: 3 }, data: { surface: 'mobile' } });
    // Local fixture URLs are confined to this test schema; public runner policy remains HTTPS.
    await prisma.website.update({ where: { id: site.id }, data: { url: websiteUrl } });
    await writeFile(join(dir, `${site.id}.json`), JSON.stringify({ version: 1, embeddingModel: 'gemini-embedding-001', dimensions: 2, createdAt: new Date().toISOString(), sourceUrl: websiteUrl, siteLinks: [], pages: [{ url: websiteUrl + '/fees', path: '/fees', pageType: 'pricing', contentHash: 'fixture', lastCrawled: new Date().toISOString() }], documents: [{ id: 'fixture-legal-fees', url: websiteUrl + '/fees', page: '/fees', pageType: 'pricing', section: 'fees', title: 'Legal consultation pricing', heading: 'Consultation fees', language: 'English', hash: 'fixture', lastCrawled: new Date().toISOString(), content: 'Legal consultation costs $99. Property and family law consultation is available. Our consultation fees and services are explained on this pricing page.', embedding: [1, 0] }] }));
    await prisma.businessAction.create({ data: { organizationId: org.id, websiteId: site.id, actionId: 'pricing', label: 'View Fees', destinationType: 'URL', destination: 'https://example.com/fees', enabled: true } });
    const { executeReplay } = await import(new URL('../../../popup-replay-runner/src/replay.mjs', import.meta.url).href);
    const identities = new Set<string>();
    for (let ordinal = 1; ordinal <= 3; ordinal++) {
      await prisma.website.update({ where: { id: site.id }, data: { url: 'https://8.8.8.8' } });
      const job = (await service.claimRun(runner))!; assert.ok(job);
      await prisma.website.update({ where: { id: site.id }, data: { url: websiteUrl } });
      const report = await executeReplay({ ...job, websiteUrl }, { backendUrl, allowLocalFixture: true, heartbeat: () => service.authorizedRun(job.id, runner.id, job.runToken) });
      assert.notEqual(report.result.outcome, 'failed', report.result.reason);
      assert.ok(report.identity?.visitorId); assert.ok(!identities.has(report.identity.visitorId)); identities.add(report.identity.visitorId);
      const finished = await service.finishRun(runner.id, job.id, job.runToken, report.result, report.screenshot ? Buffer.from(report.screenshot, 'base64') : undefined);
      const stored = await prisma.popupReplayRun.findUniqueOrThrow({ where: { id: job.id } });
      const trace = service.rows(stored.trace);
      assert.ok(trace.some(e => e.kind === 'signals' && Number(e.accepted) > 0));
      if (ordinal > 1) { assert.equal(finished.status, 'SUPPRESSED'); assert.ok(trace.some(e => e.blockedReason === job.scenario)); }
      else { assert.equal(finished.status, 'DISPLAYED', JSON.stringify(trace.filter(e => e.kind === 'decision'))); }
      assert.ok(stored.screenshot?.length); await writeFile(join(dir, `run-${ordinal}.jpg`), stored.screenshot!);
      console.log(JSON.stringify({ ordinal, scenario: job.scenario, status: finished.status, accepted: trace.filter(e => e.kind === 'signals').map(e => e.accepted), reasons: trace.map(e => e.reason).filter(Boolean), calls: stored.externalCalls }));
    }
    const finalBatch = await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: batch.id }, include: { runs: true } });
    assert.equal(finalBatch.status, finalBatch.runs.some(r => r.status === 'DISPLAYED') ? 'COMPLETED' : 'PAUSED');
    assert.equal(await prisma.analyticsEvent.count({ where: { websiteId: site.id } }), 0);
    assert.equal(await prisma.aiDecisionLog.count({ where: { websiteId: site.id } }), 0);
    assert.equal(await prisma.conversation.count({ where: { websiteId: site.id } }), 0);
    console.log(JSON.stringify({ embeddingStubs, generationStubs, externalAICalls: 0, evidence: dir }));
  } finally {
    __setProvidersForTests(null, null); globalThis.fetch = originalFetch;
    await prisma.organization.delete({ where: { id: org.id } }); await prisma.$disconnect();
    await Promise.all([new Promise<void>(r => apiServer.close(() => r())), new Promise<void>(r => siteServer.close(() => r()))]);
    // Keep screenshots as review evidence; remove only this fixture's knowledge file.
    await rm(join(dir, `${site.id}.json`), { force: true });
  }
});
