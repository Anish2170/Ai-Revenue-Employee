/** A blocked publication must check the lease after its blocking row locks. */
import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';
process.env.OPENAI_API_KEY = '';
const job = { id: 'job', websiteId: 'site', organizationId: 'org', lockedBy: 'worker', attempt: 1, sourceUrl: 'https://fixture.invalid' };
let current: any, ready = false, deletedOrganization = false;
const fake: any = {
  $queryRaw: async (strings: TemplateStringsArray) => {
    if (strings.join('').includes('FROM "Organization"') && deletedOrganization) return [];
    if (strings.join('').includes('"Website"')) {
      await new Promise(resolve => setTimeout(resolve, 70));
      return [{ id: 'site', url: job.sourceUrl }];
    }
    return [{ id: 'job' }];
  },
  knowledgeBuild: {
    findFirst: async ({ where }: any) => !where.leaseExpiresAt || current.leaseExpiresAt > where.leaseExpiresAt.gt ? current : null,
    updateMany: async ({ where }: any) => {
      if (current.leaseExpiresAt <= where.leaseExpiresAt.gt) return { count: 0 };
      current.status = 'SUCCESS'; return { count: 1 };
    },
  },
  knowledgeSnapshot: { updateMany: async () => { ready = true; return { count: 1 }; } },
  $transaction: async (fn: any) => fn(fake),
};
(globalThis as any).prisma = fake;
const { publishKnowledgeBuild, LeaseLostError } = await import('./publication.js');
const { config } = await import('../config/index.js');
test('publication rejects a lease that expires while awaiting the website row lock', async () => {
  current = { ...job, status: 'RUNNING', snapshotId: 'snapshot', configuration: null, leaseExpiresAt: new Date(Date.now() + 30) };
  const snapshot: any = { version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 2, sourceUrl: job.sourceUrl, pages: [],
    documents: [{ id: 'doc', embedding: [1, 0] }] };
  await assert.rejects(publishKnowledgeBuild(job, 'snapshot', { provider: 'LOCAL', storageKey: 'fixture', contentSha256: 'fixture', contentBytes: 1, etag: null }, snapshot), LeaseLostError);
  assert.equal(current.status, 'RUNNING'); assert.equal(ready, false);
});
test('ordinary strict publication refuses a soft-deleted organization', async () => {
  deletedOrganization = true;
  current = { ...job, status: 'RUNNING', snapshotId: 'snapshot', configuration: null, leaseExpiresAt: new Date(Date.now() + 10000) };
  const snapshot: any = { version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 2, sourceUrl: job.sourceUrl, pages: [], documents: [{ id: 'doc', embedding: [1, 0] }] };
  await assert.rejects(publishKnowledgeBuild(job, 'snapshot', { provider: 'LOCAL', storageKey: 'fixture', contentSha256: 'fixture', contentBytes: 1, etag: null }, snapshot), LeaseLostError);
  assert.equal(current.status, 'RUNNING'); assert.equal(ready, false);
});
