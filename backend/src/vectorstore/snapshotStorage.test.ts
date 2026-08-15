import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalSnapshotStorage, R2SnapshotStorage, SnapshotIntegrityError, loadSnapshotArtifact, r2SnapshotKey, setSnapshotStorageForTests, snapshotSha256, type SnapshotStorage } from './snapshotStorage.js';

test('generates immutable R2 snapshot keys', () => {
  assert.equal(r2SnapshotKey('org', 'site', 'snap'), 'knowledge/v1/org/org/website/site/snapshot/snap.json');
});

test('local storage writes and reads exact bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'knowledge-storage-'));
  try {
    const storage = new LocalSnapshotStorage();
    const bytes = Buffer.from('{"version":1}');
    const artifact = await storage.write(join(dir, 'snapshot.json'), bytes);
    assert.equal(artifact.contentBytes, bytes.byteLength);
    assert.deepEqual((await storage.read(artifact.storageKey))?.bytes, bytes);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects checksum mismatch and reports missing artifacts', async () => {
  const fake: SnapshotStorage = {
    provider: 'R2',
    write: async () => { throw new Error('not used'); },
    read: async (key) => key === 'missing' ? null : { bytes: Buffer.from('{"version":1}'), etag: null },
  };
  setSnapshotStorageForTests(fake);
  try {
    assert.equal(await loadSnapshotArtifact({ provider: 'R2', storageKey: 'missing' }), null);
    await assert.rejects(() => loadSnapshotArtifact({ provider: 'R2', storageKey: 'wrong', contentSha256: 'not-a-checksum' }), SnapshotIntegrityError);
  } finally { setSnapshotStorageForTests(null); }
});

test('R2 storage writes and verifies exact bytes', async () => {
  const objects = new Map<string, Buffer>();
  const client = { async send(command: { constructor: { name: string }; input: { Key: string; Body?: Buffer } }) {
    const { name } = command.constructor; const { Key } = command.input;
    if (name === 'HeadObjectCommand') { if (!objects.has(Key)) { const err = new Error('missing'); err.name = 'NotFound'; throw err; } return { ContentLength: objects.get(Key)!.byteLength, ETag: 'etag' }; }
    if (name === 'PutObjectCommand') { objects.set(Key, command.input.Body!); return { ETag: 'etag' }; }
    if (name === 'GetObjectCommand') return { Body: { transformToByteArray: async () => objects.get(Key)! }, ETag: 'etag' };
    throw new Error('unexpected command');
  } };
  const storage = new R2SnapshotStorage(client, 'bucket');
  const bytes = Buffer.from('{"version":1}');
  const written = await storage.write('immutable.json', bytes);
  assert.equal(written.contentSha256, snapshotSha256(bytes));
  assert.deepEqual((await storage.read('immutable.json'))?.bytes, bytes);
  await assert.rejects(() => storage.write('immutable.json', bytes), /Refusing to overwrite/);
});
