import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../db/prisma.js';
import { pruneKnowledgeSnapshots } from './snapshot-retention.js';
import { r2SnapshotKey, setSnapshotStorageForTests, snapshotSha256 } from '../vectorstore/snapshotStorage.js';
import { config } from '../config/index.js';

test('retention protects the latest three, tenant boundaries, and backups when storage fails', async () => {
  const original = prisma.$transaction;
  const bytes = Buffer.from(JSON.stringify({ version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 1, documents: [{ id: 'fixture', content: 'knowledge', embedding: [1] }] }));
  const snapshots = ['newest', 'second', 'third', 'oldest'].map(id => ({
    id, storageKey: r2SnapshotKey('org', 'site', id), contentSha256: snapshotSha256(bytes),
  }));
  const steps: string[] = [];
  let owned = true;
  let readMode: 'ok' | 'missing' | 'corrupt' = 'ok';
  let deleteFailure = false;
  const tx = {
    $queryRaw: async (_query: TemplateStringsArray, ...values: unknown[]) => {
      assert.deepEqual(values, ['site', 'org']);
      return owned ? [{ id: 'site' }] : [];
    },
    knowledgeSnapshot: {
      findMany: async (args: unknown) => {
        assert.deepEqual(args, {
          where: { organizationId: 'org', websiteId: 'site', status: 'READY', storageProvider: 'R2' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        return snapshots;
      },
      delete: async ({ where }: { where: { id: string } }) => { steps.push(`metadata:${where.id}`); },
    },
  };
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  setSnapshotStorageForTests({
    provider: 'R2',
    write: async () => { throw new Error('unexpected write'); },
    read: async key => {
      assert.equal(key, snapshots[0]!.storageKey);
      if (readMode === 'missing') return null;
      return { bytes: readMode === 'corrupt' ? Buffer.from('corrupt') : bytes, etag: null };
    },
    delete: async key => {
      if (deleteFailure) throw new Error('storage unavailable');
      steps.push(`object:${key}`);
    },
  });
  try {
    assert.equal(await pruneKnowledgeSnapshots('org', 'site'), 1);
    assert.deepEqual(steps, [`object:${snapshots[3]!.storageKey}`, 'metadata:oldest']);
    steps.length = 0;
    owned = false;
    assert.equal(await pruneKnowledgeSnapshots('org', 'site'), 0);
    owned = true;
    readMode = 'missing';
    await assert.rejects(pruneKnowledgeSnapshots('org', 'site'), /not readable/);
    readMode = 'corrupt';
    await assert.rejects(pruneKnowledgeSnapshots('org', 'site'), /checksum mismatch/);
    readMode = 'ok';
    deleteFailure = true;
    await assert.rejects(pruneKnowledgeSnapshots('org', 'site'), /storage unavailable/);
    assert.deepEqual(steps, []);
    deleteFailure = false;
    snapshots[3]!.storageKey = snapshots[0]!.storageKey;
    assert.equal(await pruneKnowledgeSnapshots('org', 'site'), 0);
    snapshots[3]!.storageKey = r2SnapshotKey('other-org', 'site', 'oldest');
    assert.equal(await pruneKnowledgeSnapshots('org', 'site'), 0);
    assert.deepEqual(steps, []);
  } finally {
    prisma.$transaction = original;
    setSnapshotStorageForTests(null);
  }
});
