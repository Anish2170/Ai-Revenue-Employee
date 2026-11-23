import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

test('replay additive migration and durable concurrency on isolated PostgreSQL', { skip: !process.env.REPLAY_TEST_DATABASE_URL, timeout: 60000 }, async t => {
  const target = new URL(process.env.REPLAY_TEST_DATABASE_URL!);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55447'); assert.equal(target.pathname, '/ai_employee_phase47_test'); assert.match(target.searchParams.get('schema') ?? '', /^popup_replay_\d{8}$/);
  process.env.DATABASE_URL = target.href; process.env.OPENAI_API_KEY = ''; process.env.GEMINI_API_KEY = '';
  const { prisma } = await import('../db/prisma.js');
  const service = await import('./service.js');
  const orgs: string[] = [];
  async function fixture(count = 8) {
    const org = await prisma.organization.create({ data: { name: 'Replay QA fixture', slug: randomUUID() } }); orgs.push(org.id);
    const site = await prisma.website.create({ data: { organizationId: org.id, name: 'Replay Law', url: 'https://8.8.8.8', widget: { create: { siteId: randomUUID(), widgetPublicKey: randomUUID() } } } });
    const owner = randomUUID(); const paired = await service.createRunner(org.id, owner, 'Fixture laptop');
    const credentials = await service.pairRunner(paired.pairingCode); const runner = await service.authenticateRunner(credentials.token);
    const batch = await service.createBatch(org.id, owner, { websiteId: site.id, runnerId: runner.id, count, scenarios: ['pricing'], surface: 'desktop', budgetMicros: 1000000 });
    return { org, site, owner, runner, batch, credentials };
  }
  try {
    await t.test('pairing consumes the one-time code and stores neither raw credential', async () => {
      const org = await prisma.organization.create({ data: { name: 'Pair fixture', slug: randomUUID() } }); orgs.push(org.id);
      const opened = await service.createRunner(org.id, randomUUID(), 'Pair laptop');
      const replies = await Promise.allSettled([service.pairRunner(opened.pairingCode), service.pairRunner(opened.pairingCode)]);
      assert.equal(replies.filter(r => r.status === 'fulfilled').length, 1);
      const row = await prisma.popupReplayRunner.findUniqueOrThrow({ where: { id: opened.runner.id } });
      assert.equal(row.pairingHash, null); assert.ok(row.tokenHash); assert.notEqual(row.tokenHash, opened.pairingCode);
    });
    await t.test('concurrent job claims return exactly one leased journey', async () => {
      const f = await fixture(); const claimed = await Promise.all(Array.from({ length: 6 }, () => service.claimRun(f.runner)));
      assert.equal(claimed.filter(Boolean).length, 1);
      assert.equal(await prisma.popupReplayRun.count({ where: { batchId: f.batch.id, status: 'RUNNING' } }), 1);
      const job = claimed.find(Boolean)!; await assert.rejects(service.authorizedRun(job.id, f.runner.id, 'forged'));
    });
    await t.test('budget reservations serialize and never exceed the one-dollar cap', async () => {
      const f = await fixture(); const job = (await service.claimRun(f.runner))!;
      const calls = await Promise.allSettled(Array.from({ length: 8 }, () => service.reserveCall(job.id, 300000, { callKind: 'generation', model: 'fixture' })));
      assert.equal(calls.filter(r => r.status === 'fulfilled').length, 3);
      const batch = await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } });
      assert.equal(batch.reservedMicros, 900000); assert.equal(batch.externalCalls, 3); assert.equal(batch.status, 'BUDGET_STOP');
      await assert.rejects(service.authorizedRun(job.id, f.runner.id, job.runToken));
      assert.equal(await service.claimRun(f.runner), null);
    });
    await t.test('per-run external calls are bounded independently of the dollar allowance', async () => {
      const f = await fixture(); const job = (await service.claimRun(f.runner))!;
      for (let i = 0; i < 4; i++) await service.reserveCall(job.id, 100, {});
      await assert.rejects(service.reserveCall(job.id, 100, {}));
      await assert.rejects(service.reserveCall(job.id, -100, {}));
      assert.equal((await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).reservedMicros, 400);
    });
    await t.test('stopping a batch revokes the browser lease and all further paid attempts', async () => {
      const f = await fixture(); const job = (await service.claimRun(f.runner))!;
      await service.controlBatch(f.org.id, f.batch.id, 'stop');
      await assert.rejects(service.authorizedRun(job.id, f.runner.id, job.runToken)); await assert.rejects(service.reserveCall(job.id, 10, {}));
      assert.equal(await prisma.popupReplayRun.count({ where: { batchId: f.batch.id, status: 'CANCELLED' } }), 8);
    });
    await t.test('provider calls reserve first, cap output, isolate async scope and never run after Stop', async () => {
      const f = await fixture(); const job = (await service.claimRun(f.runner))!;
      const { replayScope, replayStructured, currentReplay } = await import('./runtime.js');
      const scope = { runId: job.id, batchId: f.batch.id, runnerId: f.runner.id, siteId: job.siteId };
      const req = { system: 'System', user: 'Question', schema: {}, maxOutputTokens: 900 };
      let invocations = 0;
      await replayScope.run(scope, () => replayStructured('openai:gpt-6-luna', req, async value => {
        invocations++; assert.equal(value.maxOutputTokens, 512);
        assert.equal((await prisma.popupReplayRun.findUniqueOrThrow({ where: { id: job.id } })).externalCalls, 1);
        return 'fixture';
      }));
      assert.equal(currentReplay(), undefined);
      await replayStructured('unknown-provider', req, async value => { assert.equal(value, req); invocations++; });
      await assert.rejects(replayScope.run(scope, () => replayStructured('unknown-provider', req, async () => { invocations++; })));
      await service.controlBatch(f.org.id, f.batch.id, 'stop');
      await assert.rejects(replayScope.run(scope, () => replayStructured('openai:gpt-6-luna', req, async () => { invocations++; })));
      assert.equal(invocations, 2);
    });
    await t.test('disconnect and expired browser leases pause queued work without rerunning a paid journey', async () => {
      const f = await fixture(); const job = (await service.claimRun(f.runner))!;
      await prisma.popupReplayRun.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(0) } });
      await service.claimRun(f.runner);
      assert.equal((await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).status, 'PAUSED');
      assert.equal((await prisma.popupReplayRun.findUniqueOrThrow({ where: { id: job.id } })).status, 'FAILED');
    });
    await t.test('server display receipts and matching validated copy authorize gallery results once', async () => {
      const f = await fixture(1); const job = (await service.claimRun(f.runner))!;
      const popup = { title: 'Legal pricing', body: 'Question about legal pricing?', type: 'pricing', cta: 'View Pricing' };
      await service.appendTrace(job.id, { kind: 'decision', decisionId: 'candidate-a', popupType: 'pricing', popup });
      await service.appendTrace(job.id, { kind: 'lifecycle', operation: 'displayed', ok: true, popupId: 'candidate-a' });
      assert.equal((await service.finishRun(f.runner.id, job.id, job.runToken, { outcome: 'displayed', popup, steps: [] })).status, 'DISPLAYED');
      await assert.rejects(service.finishRun(f.runner.id, job.id, job.runToken, { outcome: 'displayed', popup, steps: [] }));
      assert.equal((await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).status, 'COMPLETED');
    });
    await t.test('a five-run pilot without a useful display pauses, preserving remaining journeys', async () => {
      const f = await fixture(8);
      for (let i = 0; i < 5; i++) {
        const job = (await service.claimRun(f.runner))!; assert.ok(job);
        await service.appendTrace(job.id, { kind: 'signals', accepted: 2, reason: 'low_confidence' });
        await service.finishRun(f.runner.id, job.id, job.runToken, { outcome: 'silent', steps: [] });
      }
      assert.equal((await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).status, 'PAUSED');
      assert.equal(await prisma.popupReplayRun.count({ where: { batchId: f.batch.id, status: 'QUEUED' } }), 3);
      await service.controlBatch(f.org.id, f.batch.id, 'resume');
      const next = (await service.claimRun(f.runner))!; assert.equal(next.ordinal, 6);
      await service.appendTrace(next.id, { kind: 'signals', accepted: 2 });
      await service.finishRun(f.runner.id, next.id, next.runToken, { outcome: 'silent', steps: [] });
      assert.equal((await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).status, 'RUNNING');
      assert.equal((await service.claimRun(f.runner))?.ordinal, 7);
    });
    await t.test('another organization cannot inspect or stop a replay batch', async () => {
      const f = await fixture(); await assert.rejects(service.controlBatch(randomUUID(), f.batch.id, 'stop'));
      await assert.rejects(service.createBatch(randomUUID(), f.owner, { websiteId: f.site.id, runnerId: f.runner.id, count: 1, scenarios: ['pricing'], surface: 'desktop', budgetMicros: 1000000 }));
      assert.equal((await prisma.popupReplayBatch.findUniqueOrThrow({ where: { id: f.batch.id } })).status, 'QUEUED');
    });
    await t.test('expiry removes replay artifacts only, leaving the website intact', async () => {
      const f = await fixture(); await prisma.popupReplayBatch.update({ where: { id: f.batch.id }, data: { expiresAt: new Date(0) } });
      await service.sweepReplayArtifacts();
      assert.equal(await prisma.popupReplayBatch.findUnique({ where: { id: f.batch.id } }), null);
      assert.ok(await prisma.website.findUnique({ where: { id: f.site.id } }));
    });
  } finally { await prisma.organization.deleteMany({ where: { id: { in: orgs } } }); await prisma.$disconnect(); }
});
