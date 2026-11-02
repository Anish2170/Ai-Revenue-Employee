/** Real service + repository against transactional DB/storage/HTTP fakes only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeSnapshot } from '../context/types.js';
import type { SnapshotStorage } from '../vectorstore/snapshotStorage.js';
import { r2SnapshotKey, snapshotSha256 } from '../vectorstore/snapshotStorage.js';
import { config } from '../config/index.js';
import { buildActionGraph, extractActionsFromHtml } from './actionDiscovery.js';
import { createActionRefresh, preservedKnowledgeDigest, type RefreshIdentity } from './actionRefresh.js';
import { createActionRefreshRepository } from './actionRefresh.repository.js';
import { REFRESH_AUDIT_ACTION } from './actionRefreshPins.js';
import type { PrismaClient } from '@prisma/client';

const identity: RefreshIdentity = { organizationId: '11111111-1111-4111-8111-111111111111',
  websiteId: '61b05489-cd4b-4bc8-aa97-1195f590fb7d', userId: '22222222-2222-4222-8222-222222222222' };
const originalId = 'db2d4c51-667d-4502-a10c-7cb58c63dd71';
const gym = 'https://gym-app-lyart-mu.vercel.app';
const homepage = `<title>Fitness business</title><main><h1>Training and coaching</h1><p>Our team offers personal training and structured programs for members. Explore our published plans or book a fitness assessment.</p>
  <a href="/pricing">Pricing</a><a href="/contact">Contact</a><a href="/join">Join Now</a>
  <a href="/book-assessment">Book Fitness Assessment</a><a href="/claim-free-session">Claim Free Session</a></main>`;

async function fixture(origin = gym) {
  const page = { url: origin + '/', path: '/', pageType: 'home' as const, contentHash: 'page', title: 'Fitness', text: 'Published facts.', lastCrawled: '' };
  const oldGraph = await buildActionGraph(extractActionsFromHtml('<a href="/">Pricing</a><a href="/pricing">Pricing</a>', page), { rulesOnly: true });
  const snapshot: KnowledgeSnapshot = { version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 2, createdAt: '2026-11-01T00:00:00.000Z',
    sourceUrl: origin + '/', pages: [page, { ...page, url: origin + '/pricing', path: '/pricing', pageType: 'pricing' }],
    siteLinks: [{ url: origin + '/pricing', label: 'Pricing' }], actionGraph: oldGraph,
    publication: { id: originalId, completedAt: '2026-11-01T00:00:00.000Z', completeness: 'complete', changed: 1, unchanged: 0, removed: 0, embeddingsReused: 0 },
    documents: [{ id: 'source#one', url: origin + '/pricing', page: '/pricing', pageType: 'pricing', section: 'prices', heading: 'Membership', title: 'Pricing', language: 'English', hash: 'source-hash', lastCrawled: '2026-11-01', content: 'Peak membership costs $79/month.', embedding: [.1, .2] }],
  };
  const bytes = Buffer.from(JSON.stringify(snapshot));
  const baseRow = { id: originalId, websiteId: identity.websiteId, organizationId: identity.organizationId, status: 'READY', storageProvider: 'R2',
    storageKey: r2SnapshotKey(identity.organizationId, identity.websiteId, originalId), contentSha256: snapshotSha256(bytes), contentBytes: bytes.length,
    sourceUrl: snapshot.sourceUrl, embeddingModel: snapshot.embeddingModel, dimensions: 2, pagesCrawled: 2, chunkCount: 1, createdAt: new Date('2026-11-01') };
  const objects = new Map([[baseRow.storageKey, bytes]]);
  const data = { rows: [baseRow], audits: [] as any[], overrides: [] as any[],
    website: { id: identity.websiteId, organizationId: identity.organizationId, url: origin + '/', updatedAt: new Date('2026-11-01'), deletedAt: null as Date | null },
    builds: [{ id: 'build-original', websiteId: identity.websiteId, organizationId: identity.organizationId, status: 'SUCCESS', snapshotId: originalId, updatedAt: new Date('2026-11-01') }],
    owner: true, organizationDeleted: false, writes: 0, deletes: 0, invalidations: [] as string[], failAudit: false,
    steps: [] as string[], requested: [] as string[], now: Date.parse('2026-11-03T00:00:00Z'),
    onWrite: undefined as (() => void) | undefined, onLock: undefined as (() => void) | undefined,
    corruptUpload: false, failUpload: false, corruptRead: false, readbackWrongIdentity: false,
    onFetch: undefined as (() => void) | undefined,
  };
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: any) => {
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  });
  const tx: any = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const query = sql.join('');
      if (query.includes('FROM "Website"')) {
        data.steps.push('website-lock');
        return values[0] === data.website.id && values[1] === data.website.organizationId && !data.website.deletedAt ? [data.website] : [];
      }
      assert.ok(query.includes('OrganizationMember'));
      return data.owner && !data.organizationDeleted && values[0] === identity.organizationId && values[1] === identity.userId ? [{ id: 'membership' }] : [];
    },
    $executeRaw: async (sql: TemplateStringsArray) => { assert.match(sql.join(''), /LOCK TABLE "ActionUrlOverride" IN SHARE MODE/); data.steps.push('override-lock'); data.onLock?.(); return 0; },
    knowledgeBuild: {
      count: async ({ where }: any) => data.builds.filter(row => matches(row, where)).length,
      findFirst: async ({ where }: any) => data.builds.filter(row => matches(row, where)).at(-1) ?? null,
    },
    actionUrlOverride: { findMany: async ({ where }: any) => structuredClone(data.overrides.filter(row => matches(row, where)).sort((a, b) => a.intent.localeCompare(b.intent))) },
    knowledgeSnapshot: {
      findFirst: async ({ where }: any) => structuredClone(data.rows.filter(row => matches(row, where)).sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null),
      create: async ({ data: row }: any) => { data.steps.push('activate'); data.rows.push(row); return row; },
    },
    auditLog: { create: async ({ data: row }: any) => { data.steps.push('audit-pin'); if (data.failAudit) throw Error('audit unavailable'); data.audits.push(row); return row; } },
  };
  // Transactions serialize like the website lock; failed metadata writes roll back.
  let queue = Promise.resolve();
  const db = { $transaction: (fn: (tx: any) => Promise<unknown>) => {
    const operation = queue.then(async () => {
      const rows = structuredClone(data.rows), audits = structuredClone(data.audits);
      try { return await fn(tx); } catch (error) { data.rows = rows; data.audits = audits; throw error; }
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } } as unknown as PrismaClient;
  const storage: SnapshotStorage = { provider: 'R2',
    read: async key => {
      const bytes = objects.get(key); if (!bytes) return null;
      return { bytes: data.corruptRead ? Buffer.from('corrupt') : Buffer.from(bytes), etag: 'etag' };
    },
    write: async (key, bytes) => {
      data.steps.push('upload'); if (data.failUpload) throw Error('storage failed');
      if (objects.has(key)) throw Error('immutable collision');
      objects.set(key, data.corruptUpload ? Buffer.from('corrupt') : Buffer.from(bytes)); data.writes++;
      if (data.readbackWrongIdentity) { const parsed = JSON.parse(bytes.toString()); parsed.publication.id = 'wrong'; objects.set(key, Buffer.from(JSON.stringify(parsed))); }
      data.onWrite?.();
      return { provider: 'R2', storageKey: key, contentSha256: snapshotSha256(bytes), contentBytes: bytes.length, etag: 'etag' };
    },
    delete: async () => { data.deletes++; throw Error('deletion forbidden'); },
  };
  const repository = createActionRefreshRepository({ db, storage: provider => { assert.equal(provider, 'R2'); return storage; }, now: () => data.now,
    invalidate: website => { data.invalidations.push(website); } });
  const responses = new Map<string, { status: number; body: string; type: string; redirect?: string }>([
    [origin + '/robots.txt', { status: 200, body: 'User-agent: *\nAllow: /', type: 'text/plain' }],
    [origin + '/', { status: 200, body: homepage, type: 'text/html; charset=utf-8' }],
    [origin + '/pricing', { status: 200, body: '<title>Pricing</title><main><h1>Published plans</h1><p>Compare the membership access levels and included training benefits on this public pricing page.</p><a href="/pricing">View Pricing</a></main>', type: 'text/html' }],
  ]);
  let serial = 0;
  const tool = createActionRefresh({ repository, now: () => data.now, uuid: () => `33333333-3333-4333-8333-${String(++serial).padStart(12, '0')}`,
    sleep: async ms => { data.now += ms; },
    fetch: async (url, options) => {
      assert.equal(options.allowedOrigin, origin); assert.ok(options.maxBytes! <= 2 * 1024 * 1024); assert.ok(options.signal);
      await options.onRequest?.(new URL(url)); data.requested.push(url);
      const response = responses.get(url); if (!response) throw Error('unexpected URL');
      if (response.redirect) { await options.onRequest?.(new URL(response.redirect)); data.requested.push(response.redirect); }
      data.onFetch?.();
      return { status: response.status, body: Buffer.from(response.body), url: response.redirect ?? url, headers: { 'content-type': response.type } };
    },
  });
  function saveFixtureSnapshot() {
    const bytes = Buffer.from(JSON.stringify(snapshot)); objects.set(baseRow.storageKey, bytes);
    data.rows[0].contentSha256 = snapshotSha256(bytes); data.rows[0].contentBytes = bytes.length; data.rows[0].pagesCrawled = snapshot.pages.length;
  }
  return { data, db, tx, storage, objects, snapshot, baseRow, responses, repository, tool, origin, saveFixtureSnapshot };
}

test('rules-only switch never invokes generation, even for unknown controls', async () => {
  const f = await fixture(); let calls = 0;
  const page = { ...f.snapshot.pages[0], title: 'Public', text: 'Facts' };
  const graph = await buildActionGraph(extractActionsFromHtml('<a href="/mystery">Explore possibilities</a><a href="/contact">Contact</a>', page),
    { rulesOnly: true, generate: async () => { calls++; throw Error('paid generation forbidden'); } });
  assert.equal(calls, 0); assert.deepEqual(graph.nodes.map(n => n.intent), ['contact']);
});

test('GYM dry-run reports groups/destinations/valid override impact and performs no writes', async t => {
  const f = await fixture();
  f.data.overrides.push({ id: 'override', ...identity, intent: 'pricing', url: gym + '/pricing', updatedAt: new Date('2026-11-01') });
  const report = await f.tool.dryRun(identity);
  assert.equal(report.before.length, 1); assert.equal(report.after.length, 5); assert.deepEqual(report.blockers, []);
  assert.equal(report.before[0].preferredUrl, gym + '/'); assert.equal(report.after.find(g => g.intent === 'pricing')?.preferredUrl, gym + '/pricing');
  assert.ok(report.differences.some(d => d.intent === 'book_demo')); assert.equal(report.overrides[0].result, 'preserved');
  assert.deepEqual(f.data.requested, [gym + '/robots.txt', gym + '/', gym + '/pricing']);
  assert.equal(f.data.writes, 0); assert.equal(f.data.rows.length, 1); assert.deepEqual(f.data.audits, []);
  t.diagnostic('OFFLINE_GYM_DRY_RUN ' + JSON.stringify(report));
});

test('generic website uses the same discovery rules, with no GYM business condition', async () => {
  const f = await fixture('https://clinic.example.test');
  f.responses.get(f.origin + '/')!.body = '<main><h1>Clinic</h1><p>Read our public treatment descriptions and consultation details. Contact the team for additional information.</p><a href="/consultation">Book a consultation</a><a href="/contact">Contact</a></main>';
  const report = await f.tool.dryRun(identity);
  assert.ok(report.after.some(g => g.intent === 'book_demo' && g.preferredUrl === f.origin + '/consultation'));
});

for (const change of ['organization', 'website', 'user', 'owner-role', 'organization-deleted', 'website-deleted', 'foreign-storage-key'] as const) {
  test(`cross-tenant/authorization isolation: ${change}`, async () => {
    const f = await fixture(), who = { ...identity };
    if (change === 'organization') who.organizationId = '44444444-4444-4444-8444-444444444444';
    if (change === 'website') who.websiteId = '44444444-4444-4444-8444-444444444444';
    if (change === 'user') who.userId = '44444444-4444-4444-8444-444444444444';
    if (change === 'owner-role') f.data.owner = false;
    if (change === 'organization-deleted') f.data.organizationDeleted = true;
    if (change === 'website-deleted') f.data.website.deletedAt = new Date();
    if (change === 'foreign-storage-key') f.data.rows[0].storageKey = r2SnapshotKey(who.organizationId, 'other-tenant', originalId);
    await assert.rejects(f.tool.dryRun(who)); assert.deepEqual(f.data.requested, []); assert.equal(f.data.writes, 0);
  });
}

for (const scenario of ['http-failure', 'robots-failure', 'robots-disallow', 'page-budget', 'request-budget', 'byte-budget', 'not-html', 'dynamic-shell'] as const) {
  test(`failed/inaccessible or over-budget pages block apply: ${scenario}`, async () => {
    const f = await fixture(); let options = {};
    if (scenario === 'http-failure') f.responses.get(gym + '/pricing')!.status = 503;
    if (scenario === 'robots-failure') f.responses.get(gym + '/robots.txt')!.status = 503;
    if (scenario === 'robots-disallow') f.responses.get(gym + '/robots.txt')!.body = 'User-agent: *\nDisallow: /pricing';
    if (scenario === 'page-budget') options = { maxPages: 1 };
    if (scenario === 'request-budget') options = { maxRequests: 1 };
    if (scenario === 'byte-budget') { options = { maxTotalBytes: 1024 }; f.responses.get(gym + '/')!.body = homepage.repeat(3); }
    if (scenario === 'not-html') f.responses.get(gym + '/pricing')!.type = 'application/json';
    if (scenario === 'dynamic-shell') f.responses.get(gym + '/pricing')!.body = '<div id="root" aria-busy="true">Loading pricing...</div><script src="/app.js"></script>';
    const plan = await f.tool.dryRun(identity, 'refresh', options);
    assert.ok(plan.pages.some(p => p.state === 'failed')); assert.ok(plan.blockers.length);
    await assert.rejects(f.tool.apply(plan, plan.reviewDigest), /incomplete_page_fetch|no_pages_fetched/);
    assert.equal(f.data.writes, 0); assert.equal(f.data.rows.length, 1);
  });
}

for (const mutation of ['snapshot', 'build-completed', 'build-active', 'website', 'overrides', 'actor'] as const) {
  test(`stale review rejected before network/upload: ${mutation}`, async () => {
    const f = await fixture(), plan = await f.tool.dryRun(identity), requests = f.data.requested.length;
    if (mutation === 'snapshot') f.data.rows[0].createdAt = new Date('2026-11-02');
    if (mutation === 'build-completed') f.data.builds[0].updatedAt = new Date('2026-11-02');
    if (mutation === 'build-active') f.data.builds[0].status = 'RUNNING';
    if (mutation === 'website') f.data.website.updatedAt = new Date('2026-11-02');
    if (mutation === 'overrides') f.data.overrides.push({ id: 'new', ...identity, intent: 'pricing', url: gym + '/pricing', updatedAt: new Date() });
    if (mutation === 'actor') f.data.owner = false;
    await assert.rejects(f.tool.apply(plan, plan.reviewDigest)); assert.equal(f.data.requested.length, requests); assert.equal(f.data.writes, 0);
  });
}

test('invalid override is reported and remains untouched; apply does not silently discard it', async () => {
  const f = await fixture();
  f.data.overrides.push({ id: 'old', ...identity, intent: 'pricing', url: gym + '/legacy-pricing', updatedAt: new Date() });
  const plan = await f.tool.dryRun(identity); assert.equal(plan.overrides[0].result, 'would_be_invalid');
  await assert.rejects(f.tool.apply(plan, plan.reviewDigest), /owner_override_not_rediscovered/);
  assert.equal(f.data.overrides[0].url, gym + '/legacy-pricing'); assert.equal(f.data.writes, 0);
});

test('changed fetched HTML and tampered/expired plans are rejected', async () => {
  const f = await fixture(), plan = await f.tool.dryRun(identity);
  const tampered = structuredClone(plan); tampered.after[0].preferredUrl = gym + '/forged';
  await assert.rejects(f.tool.apply(tampered, plan.reviewDigest), /INVALID_REVIEW_DIGEST/);
  const extended = structuredClone(plan); extended.expiresAt = new Date(f.data.now + 7200000).toISOString();
  await assert.rejects(f.tool.apply(extended, plan.reviewDigest), /INVALID_REVIEW_DIGEST/);
  f.responses.get(gym + '/')!.body += '<a href="/login">Login</a>';
  await assert.rejects(f.tool.apply(plan, plan.reviewDigest), /REDISCOVERY_CHANGED/);
  f.data.now += 3600001; await assert.rejects(f.tool.apply(plan, plan.reviewDigest), /EXPIRED_REFRESH_PLAN/);
  assert.equal(f.data.writes, 0);
});

for (const target of ['https://other.example.test/pricing', 'http://127.0.0.1/private', gym + '/admin', gym + '/new-unpublished-page', gym + '/pricing?token=secret'] as const) {
  test(`redirect cannot escape the permitted published inventory: ${target}`, async () => {
    const f = await fixture(); f.responses.get(gym + '/pricing')!.redirect = target;
    const plan = await f.tool.dryRun(identity);
    assert.ok(plan.pages.some(p => p.reason === 'redirect_not_permitted'));
    assert.ok(!f.data.requested.includes(target)); assert.ok(plan.blockers.includes('incomplete_page_fetch'));
    assert.equal(f.data.writes, 0);
  });
}

test('foreign, excluded and secret-bearing inventory pages are reported without fetching them', async () => {
  const f = await fixture();
  const invalid = ['https://other.example.test/', 'http://127.0.0.1/private', gym + '/admin', gym + '/pricing?token=secret'];
  for (const url of invalid) f.snapshot.pages.push({ ...f.snapshot.pages[0], url });
  f.saveFixtureSnapshot();
  const report = await f.tool.dryRun(identity);
  assert.equal(report.pages.filter(p => p.state === 'excluded').length, invalid.length);
  for (const url of invalid) assert.ok(!f.data.requested.includes(url));
  assert.ok(report.blockers.length); assert.equal(f.data.writes, 0);
});

test('a build starting during dry-run invalidates the whole report', async () => {
  const f = await fixture();
  f.data.onFetch = () => { f.data.builds[0].status = 'QUEUED'; };
  await assert.rejects(f.tool.dryRun(identity), /BUILD_ACTIVE/);
  assert.equal(f.data.writes, 0);
});

test('deadline is bounded and produces an unapplicable partial report', async () => {
  const f = await fixture();
  f.data.onFetch = () => { f.data.now += 1500; };
  const report = await f.tool.dryRun(identity, 'refresh', { totalTimeoutMs: 1000 });
  assert.equal(report.networkRequests, 1); assert.ok(report.pages.some(p => p.reason === 'time_budget'));
  assert.ok(report.blockers.length); assert.equal(f.data.writes, 0);
});

test('rollback of an ordinary knowledge snapshot is rejected without network or writes', async () => {
  const f = await fixture();
  await assert.rejects(f.tool.dryRun(identity, 'rollback'), /NO_REFRESH_TO_ROLL_BACK/);
  assert.deepEqual(f.data.requested, []); assert.equal(f.data.writes, 0);
});

test('rollback rejects missing parents and never restores another tenant snapshot', async () => {
  const f = await fixture(), plan = await f.tool.dryRun(identity);
  await f.tool.apply(plan, plan.reviewDigest);
  f.data.rows.find(r => r.id === originalId)!.organizationId = 'foreign-org';
  await assert.rejects(f.tool.dryRun(identity, 'rollback'), /ROLLBACK_SNAPSHOT_NOT_FOUND/);
  assert.equal(f.data.rows.length, 2); assert.equal(f.data.deletes, 0);
});

test('rollback cannot restore different knowledge even from a valid same-tenant parent', async () => {
  const f = await fixture(), plan = await f.tool.dryRun(identity);
  await f.tool.apply(plan, plan.reviewDigest);
  f.snapshot.documents[0].content = 'Different knowledge must not be restored by an actions operation.';
  f.saveFixtureSnapshot();
  await assert.rejects(f.tool.dryRun(identity, 'rollback'), /ROLLBACK_KNOWLEDGE_MISMATCH/);
  assert.equal(f.data.rows.length, 2); assert.equal(f.data.deletes, 0);
});

test('same-millisecond activation is strictly newer for existing READY readers', async () => {
  const f = await fixture(); f.data.now = +f.baseRow.createdAt;
  const plan = await f.tool.dryRun(identity), receipt = await f.tool.apply(plan, plan.reviewDigest);
  const current = await f.repository.load(identity);
  assert.equal(current.row.id, receipt.snapshotId);
  assert.equal(Date.parse(current.row.createdAt), +f.baseRow.createdAt + 1);
});

test('cache-refresh failure returns a committed receipt, never hides a successful activation', async () => {
  const f = await fixture();
  const repository = createActionRefreshRepository({ db: f.db, storage: () => f.storage, now: () => f.data.now, invalidate: () => { throw Error('cache unavailable'); } });
  const state = await repository.load(identity);
  const clone = structuredClone(state.snapshot), id = '55555555-5555-4555-8555-555555555555';
  clone.publication!.id = id;
  clone.actionRefresh = { version: 1, operation: 'refresh', parentSnapshotId: state.row.id, appliedAt: new Date(f.data.now).toISOString(), reviewDigest: 'a'.repeat(64) };
  const receipt = await repository.publish(state, clone, 'refresh', 'a'.repeat(64), new Date(f.data.now + 10000).toISOString());
  assert.equal(receipt.cachesRefreshed, false); assert.equal(receipt.snapshotId, id); assert.equal(f.data.rows.length, 2);
});

test('safe publication preserves bytes/data/overrides and makes an immutable rollback-able version', async () => {
  const f = await fixture();
  f.data.overrides.push({ id: 'valid', ...identity, intent: 'pricing', url: gym + '/pricing', updatedAt: new Date('2026-11-01') });
  const beforeOverrides = structuredClone(f.data.overrides), oldBytes = Buffer.from(f.objects.get(f.baseRow.storageKey)!);
  const plan = await f.tool.dryRun(identity), receipt = await f.tool.apply(plan, plan.reviewDigest);
  assert.equal(f.data.rows.length, 2); assert.equal(f.data.deletes, 0); assert.equal(f.objects.size, 2);
  assert.ok(f.objects.get(f.baseRow.storageKey)!.equals(oldBytes)); assert.deepEqual(f.data.overrides, beforeOverrides);
  const current = await f.repository.load(identity);
  assert.equal(current.row.id, receipt.snapshotId); assert.equal(current.snapshot.publication?.id, receipt.snapshotId);
  assert.equal(preservedKnowledgeDigest(current.snapshot), preservedKnowledgeDigest(f.snapshot));
  assert.deepEqual(current.snapshot.documents, f.snapshot.documents); assert.deepEqual(current.snapshot.pages, f.snapshot.pages);
  assert.deepEqual(f.data.invalidations, [identity.websiteId]); assert.equal(f.data.audits[0].action, REFRESH_AUDIT_ACTION);
  assert.equal(f.data.audits[0].metadata.previousSnapshotId, originalId);
  assert.ok(f.data.steps.indexOf('upload') < f.data.steps.indexOf('activate'));
  const rollback = await f.tool.dryRun(identity, 'rollback');
  const requests = f.data.requested.length, restored = await f.tool.apply(rollback, rollback.reviewDigest);
  assert.equal(f.data.requested.length, requests, 'rollback makes no page requests');
  const reverted = await f.repository.load(identity);
  assert.deepEqual(reverted.snapshot.actionGraph, f.snapshot.actionGraph); assert.deepEqual(reverted.snapshot.documents, f.snapshot.documents);
  assert.notEqual(restored.snapshotId, originalId); assert.notEqual(restored.snapshotId, receipt.snapshotId);
  assert.equal(f.data.rows.length, 3); assert.equal(f.objects.size, 3); assert.equal(f.data.deletes, 0);
});

for (const scenario of ['upload-fails', 'upload-corrupt', 'original-corrupt', 'audit-fails', 'build-starts-during-upload', 'override-races-final-lock'] as const) {
  test(`failed publication leaves previous READY and rollback artifact intact: ${scenario}`, async () => {
    const f = await fixture(), plan = await f.tool.dryRun(identity);
    if (scenario === 'upload-fails') f.data.failUpload = true;
    if (scenario === 'upload-corrupt') f.data.corruptUpload = true;
    if (scenario === 'original-corrupt') f.data.corruptRead = true;
    if (scenario === 'audit-fails') f.data.failAudit = true;
    if (scenario === 'build-starts-during-upload') f.data.onWrite = () => { f.data.builds[0].status = 'QUEUED'; };
    if (scenario === 'override-races-final-lock') f.data.onLock = () => { f.data.overrides.push({ id: 'raced', ...identity, intent: 'pricing', url: gym + '/pricing', updatedAt: new Date() }); };
    await assert.rejects(f.tool.apply(plan, plan.reviewDigest));
    assert.equal(f.data.rows.length, 1); assert.deepEqual(f.data.audits, []); assert.deepEqual(f.data.invalidations, []);
    assert.ok(f.objects.has(f.baseRow.storageKey)); assert.equal(f.data.deletes, 0);
  });
}

test('concurrent applies cannot both activate the same reviewed parent', async () => {
  const f = await fixture(), plan = await f.tool.dryRun(identity);
  const results = await Promise.allSettled([f.tool.apply(plan, plan.reviewDigest), f.tool.apply(plan, plan.reviewDigest)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.data.rows.length, 2); assert.equal(f.data.audits.length, 1);
  assert.equal(f.data.deletes, 0);
});
