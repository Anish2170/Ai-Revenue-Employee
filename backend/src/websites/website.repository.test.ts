import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../db/prisma.js';
import { deleteWebsite } from './website.repository.js';
import { r2SnapshotKey, setSnapshotStorageForTests } from '../vectorstore/snapshotStorage.js';
import { websiteSnapshotPath } from '../vectorstore/persistence.js';

test('website deletion scopes ownership, cleans stored and interrupted uploads, and hard-deletes last', async () => {
  const original = prisma.$transaction;
  const steps: string[] = [];
  const snapshots = [
    { id: 'ready', storageProvider: 'R2', storageKey: 'ready.json' },
    { id: 'interrupted', storageProvider: 'R2', storageKey: '' },
  ];
  let owned = true;
  let storageFailure = false;
  const tx = {
    $queryRaw: async (_query: TemplateStringsArray, ...values: unknown[]) => {
      assert.deepEqual(values, ['site', 'org']);
      steps.push('lock');
      return owned ? [{ id: 'site' }] : [];
    },
    widget: { findUnique: async () => ({ siteId: 'widget-site' }) },
    knowledgeSnapshot: { findMany: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { organizationId: 'org', websiteId: 'site' });
      return snapshots;
    } },
    auditLog: { deleteMany: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { organizationId: 'org', OR: [
        { targetType: { in: ['website', 'website_action_override'] }, targetId: 'site' },
        { metadata: { path: ['websiteId'], equals: 'site' } },
      ] });
      steps.push('audit');
      return { count: 1 };
    } },
    website: { deleteMany: async ({ where }: { where: unknown }) => {
      assert.deepEqual(where, { id: 'site', organizationId: 'org' });
      steps.push('delete');
      return { count: 1 };
    } },
  };
  prisma.$transaction = (async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as unknown as typeof prisma.$transaction;
  setSnapshotStorageForTests({
    provider: 'R2',
    write: async () => { throw new Error('unexpected write'); },
    read: async () => null,
    delete: async (key) => { if (storageFailure) throw new Error('storage unavailable'); steps.push(key); },
  });
  try {
    assert.deepEqual(await deleteWebsite('org', 'site'), { count: 1, siteId: 'widget-site' });
    assert.deepEqual(steps, ['lock', websiteSnapshotPath('site'), 'ready.json', r2SnapshotKey('org', 'site', 'interrupted'), 'audit', 'delete']);
    steps.length = 0;
    owned = false;
    assert.deepEqual(await deleteWebsite('org', 'site'), { count: 0, siteId: null });
    assert.deepEqual(steps, ['lock']);
    owned = true;
    storageFailure = true;
    steps.length = 0;
    await assert.rejects(deleteWebsite('org', 'site'), /storage unavailable/);
    assert.deepEqual(steps, ['lock']); // Keep DB metadata so cleanup can be retried.
  } finally {
    prisma.$transaction = original;
    setSnapshotStorageForTests(null);
  }
});
