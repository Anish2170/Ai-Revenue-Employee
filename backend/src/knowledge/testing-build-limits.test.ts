import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';

// Nonempty synthetic URL keeps the shared limiter enabled; all DB work is fake.
process.env.DATABASE_URL = 'postgresql://synthetic.invalid/testing-builds';
process.env.OPENAI_API_KEY = ''; process.env.GEMINI_API_KEY = '';
process.env.FRONTEND_URL = 'http://localhost:3001';
process.env.DASHBOARD_ORIGIN = 'http://localhost:3001';
process.env.CORS_ORIGIN = 'http://localhost:3001';
const site = randomUUID(), org = randomUUID(), sourceUrl = 'https://93.184.216.34/';
const active = { id: randomUUID(), status: 'RUNNING', websiteId: site, organizationId: org, sourceUrl, configuration: { version: 1, budget: { mode: 'auto', maxPages: 100, maxRenderedPages: 8 } } };
let role = 'OWNER', quotaQueries = 0;
const tokenHash = createHash('sha256').update('owner').digest('hex');
const fake = {
  session: { findUnique: async ({ where }: any) => where.tokenHash === tokenHash ? { id: 'session', userId: 'owner', organizationId: org, expiresAt: new Date(Date.now() + 60000), revokedAt: null, user: { deletedAt: null }, organization: { deletedAt: null } } : null },
  organizationMember: { findUnique: async () => ({ role }) },
  website: { findFirst: async ({ where }: any) => where.id === site && where.organizationId === org ? { id: site, organizationId: org, url: sourceUrl, deletedAt: null } : null },
  knowledgeBuild: { findFirst: async () => active },
  knowledgeSnapshot: { create: async () => { throw Error('An active build must be reused'); } },
  $queryRaw: async () => [{ id: site, role }],
  $queryRawUnsafe: async () => { quotaQueries++; return [{ count: 9999 }]; },
  $executeRawUnsafe: async () => 0,
  $transaction: async (fn: (tx: any) => Promise<any>) => fn(fake),
};
(globalThis as any).prisma = fake;
const { knowledgeRouter } = await import('./knowledge.routes.js');
const { csrfTokenForSession } = await import('../auth/auth.middleware.js');
const { rateLimit, hours } = await import('../middleware/rateLimit.js');
const app = express(); app.use(express.json()); app.use(cookieParser());
app.get('/shared-limiter-fixture', rateLimit([{ name: 'unchanged', limit: 1, windowMs: hours(1), key: () => 'fixture' }]), (_req, res) => res.sendStatus(200));
app.use(knowledgeRouter);
let server: ReturnType<typeof app.listen>, base: string;
before(async () => { await new Promise<void>(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`; });
after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
const headers = () => ({ 'Content-Type': 'application/json', Cookie: 'aire_session=owner', Origin: 'http://localhost:3001', 'X-CSRF-Token': csrfTokenForSession('owner') });
const request = (path: string, body: object, suppliedHeaders = headers()) => fetch(base + path, { method: 'POST', headers: suppliedHeaders, body: JSON.stringify(body) });
const buildPath = `/api/websites/${site}/knowledge/build`;

test('repeated owner build requests ignore exhausted quotas and reuse the existing active job', async () => {
  const beforeQueries = quotaQueries;
  for (let i = 0; i < 25; i++) {
    const response = await request(buildPath, { url: sourceUrl });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { buildId: active.id, created: false, status: 'RUNNING' });
  }
  assert.equal(quotaQueries, beforeQueries);
});

test('scope approval reaches scope validation even with exhausted request counters', async () => {
  const beforeQueries = quotaQueries;
  const response = await request(`${buildPath}/${active.id}/approve-scope`, { reviewHash: 'a'.repeat(64), excludedUrls: [sourceUrl + 'blog'], reason: 'Review the optional historical article.', acknowledgeLimitations: true, budget: { maxPages: 100, maxRenderedPages: 0 } });
  assert.equal(response.status, 409); // The existing RUNNING job is not reviewable.
  assert.equal(quotaQueries, beforeQueries);
});

test('authentication, CSRF, roles, ownership and conflicting active-build budgets still apply', async () => {
  assert.equal((await request(buildPath, { url: sourceUrl }, { 'Content-Type': 'application/json' } as any)).status, 401);
  const noCsrf = headers(); delete (noCsrf as Partial<typeof noCsrf>)['X-CSRF-Token'];
  assert.equal((await request(buildPath, { url: sourceUrl }, noCsrf)).status, 403);
  role = 'MEMBER';
  try { assert.equal((await request(buildPath, { url: sourceUrl })).status, 403); } finally { role = 'OWNER'; }
  assert.equal((await request(`/api/websites/${randomUUID()}/knowledge/build`, { url: sourceUrl })).status, 404);
  assert.equal((await request(buildPath, { url: sourceUrl, budget: { mode: 'manual', maxPages: 25, maxRenderedPages: 0 } })).status, 409);
});

test('the shared rate limiter remains active for other endpoints', async () => {
  const response = await fetch(base + '/shared-limiter-fixture');
  assert.equal(response.status, 429);
  assert.equal(quotaQueries, 1);
});
