/** Actual owner HTTP middleware/routes and publication code; DB/storage are isolated fixtures. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
process.env.DATABASE_URL = ''; process.env.GEMINI_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.DEBUG_TRACE = 'false';
process.env.FRONTEND_URL = 'http://localhost:3001'; process.env.DASHBOARD_ORIGIN = 'http://localhost:3001'; process.env.CORS_ORIGIN = 'http://localhost:3001';
const site = randomUUID(), otherSite = randomUUID(), org = randomUUID(), otherOrg = randomUUID(), publicOrigin = 'https://93.184.216.34';
let role = 'OWNER', member = true, auditFails = false, origin = publicOrigin;
let websiteRevision = new Date('2026-10-27T00:00:00.000Z');
let jobs: any[] = [], rows: any[] = [], audits: any[] = [], objects = new Map<string, Buffer>();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const sessions = new Map(['owner', 'foreign'].map(token => [hash(token), { id: token, userId: token, organizationId: token === 'owner' ? org : otherOrg, expiresAt: new Date(Date.now() + 3600000), revokedAt: null, user: { id: token, deletedAt: null }, organization: { deletedAt: null } }]));
const match = (row: any, where: any): boolean => Object.entries(where ?? {}).every(([key, value]: [string, any]) => value?.gt ? new Date(row[key]) > value.gt : value?.in ? value.in.includes(row[key]) : value?.not ? row[key] !== value.not : row[key] === value);
function model(list: () => any[]) {
  return {
    findFirst: async ({ where, orderBy }: any) => { const found = list().filter(row => match(row, where)); return orderBy ? found.sort((a, b) => +b.createdAt - +a.createdAt)[0] ?? null : found[0] ?? null; },
    findMany: async ({ where }: any) => list().filter(row => match(row, where)),
    findUnique: async ({ where }: any) => list().find(row => match(row, where)) ?? null,
    create: async ({ data }: any) => { const row = { id: randomUUID(), createdAt: new Date(Date.now() + list().length), attempt: 0, ...data }; list().push(row); return row; },
    updateMany: async ({ where, data }: any) => { const found = list().filter(row => match(row, where)); found.forEach(row => Object.assign(row, data)); return { count: found.length }; },
  };
}
let transaction = Promise.resolve();
const fake: any = {
  session: { findUnique: async ({ where }: any) => sessions.get(where.tokenHash), updateMany: async () => ({ count: 1 }) },
  organizationMember: { findUnique: async () => member ? { role } : null },
  website: { findFirst: async ({ where }: any) => [{ id: site, organizationId: org, url: origin, updatedAt: websiteRevision, deletedAt: null }, { id: otherSite, organizationId: otherOrg, url: publicOrigin, updatedAt: websiteRevision, deletedAt: null }].find(row => match(row, where)) ?? null },
  knowledgeBuild: model(() => jobs), knowledgeSnapshot: model(() => rows),
  auditLog: { create: async ({ data }: any) => { if (auditFails) throw Error('fixture audit failure'); audits.push(data); return data; } },
  $queryRaw: async (strings: TemplateStringsArray) => strings.join('').includes('OrganizationMember') ? member ? [{ role }] : [] : [{ id: site, url: origin, updatedAt: websiteRevision }],
  $transaction: async (fn: any) => {
    const prior = transaction; let release!: () => void; transaction = new Promise<void>(resolve => release = resolve); await prior;
    const backup = structuredClone({ jobs, rows, audits });
    try { return await fn(fake); } catch (error) { ({ jobs, rows, audits } = backup); throw error; } finally { release(); }
  },
};
(globalThis as any).prisma = fake;
const { knowledgeRouter } = await import('./knowledge.routes.js');
const { csrfTokenForSession } = await import('../auth/auth.middleware.js');
const { setSnapshotStorageForTests, snapshotSha256 } = await import('../vectorstore/snapshotStorage.js');
const { onboardingFixture, fixtureOrigin } = await import('./phase45Fixtures.js');
const { ingest } = await import('../services/ingestService.js');
const { publishKnowledgeBuild } = await import('./publication.js');
const { ensureKnowledgeSnapshot } = await import('./knowledge.worker.js');
const { invalidateWebsiteStore } = await import('../vectorstore/registry.js');
const { config } = await import('../config/index.js');
const app = express(); app.use(express.json()); app.use(cookieParser()); app.use(knowledgeRouter);
app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(500).json({ error: 'fixture_failure' }));
let server: ReturnType<typeof app.listen>, base: string;
before(async () => {
  setSnapshotStorageForTests({ provider: 'LOCAL', read: async key => objects.has(key) ? { bytes: objects.get(key)!, etag: null } : null,
    write: async () => { throw Error('No external writes'); }, delete: async () => { throw Error('No external deletes'); } });
  await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = 'http://127.0.0.1:' + (server.address() as import('node:net').AddressInfo).port;
});
after(async () => { setSnapshotStorageForTests(null); await new Promise<void>(resolve => server.close(() => resolve())); });
const headers = (token = 'owner', csrf = true) => ({ 'Content-Type': 'application/json', Cookie: 'aire_session=' + token, Origin: 'http://localhost:3001', ...(csrf ? { 'X-CSRF-Token': csrfTokenForSession(token) } : {}) });
const urlFor = (buildId: string, action = 'scope-review', websiteId = site) => `${base}/api/websites/${websiteId}/knowledge/build/${buildId}/${action}`;
async function reset() {
  role = 'OWNER'; member = true; auditFails = false; origin = publicOrigin; websiteRevision = new Date('2026-10-27T00:00:00.000Z'); jobs = []; rows = []; audits = []; objects.clear(); invalidateWebsiteStore(site);
  const fixture = onboardingFixture(5, '/blog/old-update'), snapshotId = randomUUID(), buildId = randomUUID();
  const manifest = JSON.parse(JSON.stringify((await fixture.crawl()).manifest).replaceAll(fixtureOrigin, publicOrigin));
  const snapshot = { version: 1, embeddingModel: config.gemini.embeddingModel, sourceUrl: publicOrigin, dimensions: 0, documents: [], pages: [], crawlManifest: manifest,
    publication: { id: snapshotId, completeness: 'partial', completedAt: new Date().toISOString() } };
  const bytes = Buffer.from(JSON.stringify(snapshot)); objects.set(snapshotId, bytes);
  rows.push({ id: snapshotId, websiteId: site, organizationId: org, status: 'FAILED', storageProvider: 'LOCAL', storageKey: snapshotId, contentSha256: snapshotSha256(bytes) });
  jobs.push({ id: buildId, websiteId: site, organizationId: org, snapshotId, sourceUrl: publicOrigin, status: 'FAILED', currentPhase: 'partial', createdAt: new Date(0) });
  return buildId;
}
async function bodyFor(buildId: string) {
  const response = await fetch(urlFor(buildId), { headers: headers() }); assert.equal(response.status, 200); const review: any = await response.json();
  return { reviewHash: review.hash, excludedUrls: [publicOrigin + '/blog/old-update'], reason: 'An obsolete optional news announcement.', acknowledgeLimitations: true, budget: { maxPages: 25, maxRenderedPages: 3 } };
}
const approve = (buildId: string, body: any, token = 'owner', csrf = true) => fetch(urlFor(buildId, 'approve-scope'), { method: 'POST', headers: headers(token, csrf), body: JSON.stringify(body) });

test('review authentication, foreign manifest access and cross-tenant approval fail closed', async () => {
  const id = await reset(); const body = await bodyFor(id);
  assert.equal((await fetch(urlFor(id))).status, 401);
  assert.equal((await fetch(urlFor(id), { headers: headers('foreign') })).status, 404);
  assert.equal((await approve(id, body, 'foreign')).status, 404);
  assert.equal((await fetch(urlFor(id, 'manifest'), { headers: headers('foreign') })).status, 404);
  assert.equal((await approve(id, body, 'owner', false)).status, 403); assert.equal(jobs.length, 1);
});
test('a different tenant using its own website cannot approve another tenant build ID', async () => {
  const id = await reset(), body = await bodyFor(id);
  const response = await fetch(urlFor(id, 'approve-scope', otherSite), { method: 'POST', headers: headers('foreign'), body: JSON.stringify(body) });
  assert.equal(response.status, 409); assert.equal(jobs.length, 1);
});
test('owner approval persists a tenant-bound scope and mandatory audit atomically', async () => {
  const id = await reset(), body = await bodyFor(id); assert.equal((await approve(id, body)).status, 202);
  assert.equal(jobs.length, 2); assert.equal(jobs[1].maxAttempts, 1); assert.equal(jobs[1].configuration.approval.organizationId, org);
  assert.equal(jobs[1].configuration.approval.approvedByUserId, 'owner'); assert.equal(audits[0].metadata.scopeHash, jobs[1].configuration.approval.hash);
});
test('forged approval, forged acknowledgement and unknown configuration keys are rejected', async () => {
  const id = await reset(), body = await bodyFor(id);
  for (const extra of [{ approval: { approvedByUserId: 'other' } }, { acknowledgeLimitations: false }, { budget: { maxPages: 101, maxRenderedPages: 3 } }]) assert.equal((await approve(id, { ...body, ...extra })).status, 400);
  assert.equal(jobs.length, 1);
});
test('review hash does not authorize injected same-origin or internal URLs', async () => {
  const id = await reset(), body = await bodyFor(id);
  for (const injected of [publicOrigin + '/blog/new', 'http://127.0.0.1/blog/private', 'http://169.254.169.254/blog/metadata']) assert.equal((await approve(id, { ...body, excludedUrls: [injected] })).status, 409);
});
test('admin and changed membership cannot approve; membership rechecked for every request', async () => {
  const id = await reset(), body = await bodyFor(id); role = 'ADMIN'; assert.equal((await approve(id, body)).status, 403);
  member = false; assert.equal((await approve(id, body)).status, 401); assert.equal(jobs.length, 1);
});
test('scope changes, artifact corruption, and source-origin changes invalidate review', async () => {
  for (const change of ['origin', 'bytes', 'inventory']) {
    const id = await reset(), body = await bodyFor(id), row = rows[0];
    if (change === 'origin') origin = 'https://different.test';
    if (change === 'bytes') objects.set(row.storageKey, Buffer.from('corrupted'));
    if (change === 'inventory') { const snapshot = JSON.parse(objects.get(row.storageKey)!.toString()); snapshot.crawlManifest.entries.pop(); const bytes = Buffer.from(JSON.stringify(snapshot)); objects.set(row.storageKey, bytes); row.contentSha256 = snapshotSha256(bytes); }
    assert.equal((await approve(id, body)).status, 409); assert.equal(jobs.length, 1);
  }
});
test('conflicting concurrent approvals create one queued build and old approval cannot replay', async () => {
  const id = await reset(), body = await bodyFor(id);
  const responses = await Promise.all([approve(id, body), approve(id, body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [202, 409]); assert.equal(jobs.length, 2);
  assert.equal((await approve(id, body)).status, 409);
});
test('failed mandatory approval audit rolls back job and snapshot creation', async () => {
  const id = await reset(), body = await bodyFor(id); auditFails = true;
  assert.equal((await approve(id, body)).status, 500); assert.equal(jobs.length, 1); assert.equal(rows.length, 1); assert.equal(audits.length, 0);
});
test('budget is persisted from the actual authenticated build request and origin remains fenced', async () => {
  await reset(); const response = await fetch(`${base}/api/websites/${site}/knowledge/build`, { method: 'POST', headers: headers(), body: JSON.stringify({ url: publicOrigin, budget: { maxPages: 50, maxRenderedPages: 5 } }) });
  assert.equal(response.status, 202); assert.deepEqual(jobs[1].configuration.budget, { maxPages: 50, maxRenderedPages: 5 });
  assert.equal((await fetch(`${base}/api/websites/${site}/knowledge/build`, { method: 'POST', headers: headers(), body: JSON.stringify({ url: 'http://127.0.0.1', budget: { maxPages: 50, maxRenderedPages: 5 } }) })).status, 400);
});
test('an active configured build cannot silently absorb a materially different budget', async () => {
  await reset(); const url = `${base}/api/websites/${site}/knowledge/build`;
  const send = (maxPages: number) => fetch(url, { method: 'POST', headers: headers(), body: JSON.stringify({ url: publicOrigin, budget: { maxPages, maxRenderedPages: 3 } }) });
  assert.equal((await send(25)).status, 202); assert.equal((await send(50)).status, 409); assert.equal(jobs.length, 2);
});
async function staged() {
  const id = await reset(), body = await bodyFor(id); assert.equal((await approve(id, body)).status, 202);
  const job = jobs[1]; Object.assign(job, { status: 'RUNNING', lockedBy: 'worker', attempt: 1, leaseExpiresAt: new Date(Date.now() + 60000) });
  const fixture = onboardingFixture(5, '/blog/old-update');
  const result = await ingest(publicOrigin, { websiteId: site, organizationId: org, snapshotId: job.snapshotId, crawlBudget: job.configuration.budget, scopeApproval: job.configuration.approval }, {
    previous: async () => null,
    crawl: async (_url, options) => {
      const localOptions = { ...options, reviewedSources: options?.reviewedSources?.map(entry => ({ ...entry, url: entry.url.replace(publicOrigin, fixtureOrigin) })) };
      return JSON.parse(JSON.stringify(await fixture.crawl(localOptions)).replaceAll(fixtureOrigin, publicOrigin));
    },
    embed: async chunks => chunks.map(chunk => ({ ...chunk, embedding: [1, 0] })),
    write: async snapshot => { const bytes = Buffer.from(JSON.stringify(snapshot)); objects.set(job.snapshotId, bytes); return { provider: 'LOCAL', storageKey: job.snapshotId, contentSha256: snapshotSha256(bytes), contentBytes: bytes.length, etag: null }; },
  });
  return { job: { ...job }, result };
}
test('limited-scope READY/SUCCESS uses the same publication transaction and lease fence', async () => {
  const { job, result } = await staged(); await publishKnowledgeBuild(job, job.snapshotId, result.snapshotArtifact, result.snapshot);
  assert.equal(rows[1].status, 'READY'); assert.equal(jobs[1].status, 'SUCCESS'); assert.equal(result.snapshot.crawlManifest!.completeWithinScope, false);
});
test('restart recovers an approved immutable upload only through the normal approval and lease checks', async () => {
  const { job, result } = await staged(); rows[1].storageKey = result.snapshotArtifact.storageKey;
  const outcome = await ensureKnowledgeSnapshot(job as any);
  assert.equal(outcome.recovered, true); assert.equal(jobs[1].status, 'SUCCESS'); assert.equal(rows[1].status, 'READY');
});
test('corrupt approved upload cannot be recovered into READY', async () => {
  const { job, result } = await staged(); rows[1].storageKey = result.snapshotArtifact.storageKey; objects.set(rows[1].storageKey, Buffer.from('corrupt'));
  // This fixture's worker ID is deliberately not the module's private current worker ID.
  await assert.rejects(ensureKnowledgeSnapshot(job as any), /lease lost/); assert.ok(!rows.some(row => row.status === 'READY'));
});
test('invalid limited refresh preserves the previous READY row and its immutable bytes', async () => {
  const { job, result } = await staged();
  const previousBytes = Buffer.from('previous usable policy and pricing fixture'); objects.set('previous-good', previousBytes);
  rows.push({ id: 'previous-good', websiteId: site, organizationId: org, status: 'READY', storageKey: 'previous-good' });
  result.snapshot.crawlManifest!.entries.find(entry => entry.url.endsWith('/refund'))!.state = 'failed';
  await assert.rejects(publishKnowledgeBuild(job, job.snapshotId, result.snapshotArtifact, result.snapshot));
  assert.equal(rows.at(-1).status, 'READY'); assert.deepEqual(objects.get('previous-good'), previousBytes); assert.equal(rows[1].status, 'BUILDING');
});
test('invalid stored approval is visible in build status without losing the status endpoint', async () => {
  const { job } = await staged(); jobs[1].configuration.approval.reason = 'tampered';
  const response = await fetch(`${base}/api/websites/${site}/knowledge/build/${job.id}`, { headers: headers() });
  assert.equal(response.status, 200); const status: any = await response.json(); assert.equal(status.configuration, null); assert.match(status.configurationError, /invalid/);
});
for (const failure of ['cancelled', 'stale', 'expired', 'membership', 'website', 'website-revision', 'configuration', 'no-db-approval'] as const) test(`limited publication rejects ${failure} and leaves previous rows unchanged`, async () => {
  const { job, result } = await staged();
  if (failure === 'cancelled') jobs[1].status = 'CANCELLED';
  if (failure === 'stale') jobs[1].attempt = 2;
  if (failure === 'expired') jobs[1].leaseExpiresAt = new Date(0);
  if (failure === 'membership') role = 'ADMIN';
  if (failure === 'website') origin += '/different-path';
  if (failure === 'website-revision') websiteRevision = new Date();
  if (failure === 'configuration') jobs[1].configuration.approval.reason = 'Tampered';
  if (failure === 'no-db-approval') jobs[1].configuration = null;
  await assert.rejects(publishKnowledgeBuild(job, job.snapshotId, result.snapshotArtifact, result.snapshot));
  assert.equal(rows[1].status, 'BUILDING'); assert.equal(rows[0].status, 'FAILED'); assert.ok(!rows.some(row => row.status === 'READY'));
});
