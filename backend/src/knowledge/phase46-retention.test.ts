/** Semantic retention regression. In-memory DB/storage only, never real R2. */
import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = ''; process.env.GEMINI_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.KNOWLEDGE_STORAGE = 'local';
const { prisma } = await import('../db/prisma.js');
const { config } = await import('../config/index.js');
const { pruneKnowledgeSnapshots } = await import('./snapshot-retention.js');
const { r2SnapshotKey, setSnapshotStorageForTests, snapshotSha256 } = await import('../vectorstore/snapshotStorage.js');
import type { KnowledgeSnapshot } from '../context/types.js';

for (const kind of ['invalid-vector', 'partial', 'wrong-model', 'wrong-publication', 'wrong-version', 'valid-legacy'] as const) {
  test(`retention validates replacement semantics before deleting backups: ${kind}`, async () => {
    const candidate: KnowledgeSnapshot = {
      version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 2, createdAt: new Date().toISOString(),
      sourceUrl: 'https://fixture.invalid', siteLinks: [], pages: [],
      documents: [{ id: 'doc', content: 'Fixture facts.', embedding: [1, 0], page: '/', url: 'https://fixture.invalid/', pageType: 'home', section: '', heading: '', title: '', language: 'English', hash: 'doc', lastCrawled: '' }],
    };
    if (kind === 'invalid-vector') candidate.documents[0].embedding = [0, 0];
    if (kind === 'wrong-model') candidate.embeddingModel = 'unreadable-model';
    if (kind === 'wrong-version') (candidate as { version: number }).version = 99;
    if (kind === 'partial' || kind === 'wrong-publication') candidate.publication = {
      id: kind === 'wrong-publication' ? 'foreign' : 'newest', completeness: kind === 'partial' ? 'partial' : 'complete', completedAt: '', changed: 0, unchanged: 0, removed: 0, embeddingsReused: 0,
    };
    const bytes = Buffer.from(JSON.stringify(candidate));
    const rows = ['newest', 'second', 'third', 'oldest'].map(id => ({ id, websiteId: 'site', organizationId: 'org', storageKey: r2SnapshotKey('org', 'site', id), contentSha256: snapshotSha256(bytes) }));
    const deleted: string[] = [];
    const original = prisma.$transaction;
    const tx = { $queryRaw: async () => [{ id: 'site' }], knowledgeSnapshot: { findMany: async () => rows, delete: async ({ where }: any) => { deleted.push(where.id); } } };
    prisma.$transaction = (async (fn: any) => fn(tx)) as typeof prisma.$transaction;
    setSnapshotStorageForTests({ provider: 'R2', read: async () => ({ bytes, etag: null }), write: async () => { throw Error('unused'); }, delete: async key => { deleted.push(key); } });
    try {
      if (kind === 'valid-legacy') { assert.equal(await pruneKnowledgeSnapshots('org', 'site'), 1); assert.equal(deleted.length, 2); }
      else { await assert.rejects(pruneKnowledgeSnapshots('org', 'site')); assert.deepEqual(deleted, []); }
    } finally { prisma.$transaction = original; setSnapshotStorageForTests(null); }
  });
}
