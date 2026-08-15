import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, hasDatabase } from '../config/index.js';
import type { KnowledgeSnapshot } from '../context/types.js';
import { prisma } from '../db/prisma.js';
import { loadSnapshotFile, websiteSnapshotPath } from './persistence.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export type StorageProviderName = 'LOCAL' | 'R2';
export interface StoredArtifact { provider: StorageProviderName; storageKey: string; contentSha256: string; contentBytes: number; etag: string | null; }
export class SnapshotStorageError extends Error { constructor(message: string) { super(message); this.name = 'SnapshotStorageError'; } }
export class SnapshotIntegrityError extends SnapshotStorageError { constructor(message: string) { super(message); this.name = 'SnapshotIntegrityError'; } }

export function snapshotSha256(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function r2SnapshotKey(organizationId: string, websiteId: string, snapshotId: string): string {
  return `knowledge/v1/org/${organizationId}/website/${websiteId}/snapshot/${snapshotId}.json`;
}
export function serializeSnapshot(snapshot: KnowledgeSnapshot): Buffer { return Buffer.from(JSON.stringify(snapshot), 'utf8'); }

export interface SnapshotStorage {
  readonly provider: StorageProviderName;
  write(key: string, bytes: Buffer): Promise<StoredArtifact>;
  read(key: string): Promise<{ bytes: Buffer; etag: string | null } | null>;
}

class LocalSnapshotStorage implements SnapshotStorage {
  readonly provider = 'LOCAL' as const;
  private pathFor(key: string) { return isAbsolute(key) ? key : resolve(backendRoot, key); }
  async write(key: string, bytes: Buffer): Promise<StoredArtifact> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { provider: this.provider, storageKey: key, contentSha256: snapshotSha256(bytes), contentBytes: bytes.byteLength, etag: null };
  }
  async read(key: string) {
    try { return { bytes: await readFile(this.pathFor(key)), etag: null }; } catch { return null; }
  }
}

type S3Like = { send(command: unknown): Promise<unknown> };
class R2SnapshotStorage implements SnapshotStorage {
  readonly provider = 'R2' as const;
  constructor(private readonly client: S3Like, private readonly bucket: string) {}
  async write(key: string, bytes: Buffer): Promise<StoredArtifact> {
    const exists = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })).then(() => true).catch(() => false);
    if (exists) throw new SnapshotStorageError('Refusing to overwrite immutable knowledge snapshot object.');
    const result = await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: 'application/json', ChecksumSHA256: Buffer.from(snapshotSha256(bytes), 'hex').toString('base64') })) as { ETag?: string };
    const verified = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })) as { ContentLength?: number; ETag?: string };
    if (verified.ContentLength !== bytes.byteLength) throw new SnapshotStorageError('R2 upload verification failed: byte size mismatch.');
    const downloaded = await this.read(key);
    if (!downloaded || snapshotSha256(downloaded.bytes) !== snapshotSha256(bytes)) throw new SnapshotStorageError('R2 upload verification failed: checksum mismatch.');
    return { provider: this.provider, storageKey: key, contentSha256: snapshotSha256(bytes), contentBytes: bytes.byteLength, etag: verified.ETag ?? result.ETag ?? null };
  }
  async read(key: string) {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> }; ETag?: string };
      if (!response.Body?.transformToByteArray) throw new SnapshotStorageError('R2 object response has no readable body.');
      return { bytes: Buffer.from(await response.Body.transformToByteArray()), etag: response.ETag ?? null };
    } catch (error) {
      const code = (error as { name?: string }).name;
      if (code === 'NoSuchKey' || code === 'NotFound') return null;
      throw error;
    }
  }
}

let storageOverride: SnapshotStorage | null = null;
export function setSnapshotStorageForTests(storage: SnapshotStorage | null): void { storageOverride = storage; }
export function getSnapshotStorage(provider?: StorageProviderName): SnapshotStorage {
  if (storageOverride) return storageOverride;
  const useR2 = provider === 'R2' || (!provider && config.knowledgeStorage === 'r2');
  if (!useR2) return new LocalSnapshotStorage();
  const endpoint = config.r2.endpoint || `https://${config.r2.accountId}.r2.cloudflarestorage.com`;
  return new R2SnapshotStorage(new S3Client({ region: config.r2.region, endpoint, credentials: { accessKeyId: config.r2.accessKeyId, secretAccessKey: config.r2.secretAccessKey } }), config.r2.bucket);
}

export async function writeSnapshotArtifact(input: { organizationId: string; websiteId: string; snapshotId: string; snapshot: KnowledgeSnapshot; localKey?: string }): Promise<StoredArtifact> {
  const storage = getSnapshotStorage();
  const key = storage.provider === 'R2' ? r2SnapshotKey(input.organizationId, input.websiteId, input.snapshotId) : (input.localKey ?? `${config.knowledgeDir}/${input.websiteId}.json`);
  return storage.write(key, serializeSnapshot(input.snapshot));
}

export async function loadSnapshotArtifact(input: { provider: StorageProviderName; storageKey: string; contentSha256?: string | null }): Promise<KnowledgeSnapshot | null> {
  const artifact = await getSnapshotStorage(input.provider).read(input.storageKey);
  if (!artifact) return null;
  const actual = snapshotSha256(artifact.bytes);
  if (input.contentSha256 && input.contentSha256 !== actual) throw new SnapshotIntegrityError('Knowledge snapshot checksum mismatch.');
  try { return JSON.parse(artifact.bytes.toString('utf8')) as KnowledgeSnapshot; } catch { throw new SnapshotStorageError('Knowledge snapshot is invalid JSON.'); }
}

/** Load the currently queryable artifact. Legacy local files remain readable when metadata is absent. */
export async function loadLatestWebsiteSnapshot(websiteId: string): Promise<{ snapshot: KnowledgeSnapshot | null; snapshotId: string | null; storageKey: string | null }> {
  const row = hasDatabase ? await prisma.knowledgeSnapshot.findFirst({ where: { websiteId, status: 'READY' }, orderBy: { createdAt: 'desc' } }).catch(() => null) : null;
  if (!row) return { snapshot: await loadSnapshotFile(websiteSnapshotPath(websiteId)), snapshotId: null, storageKey: null };
  try {
    const snapshot = await loadSnapshotArtifact({ provider: row.storageProvider, storageKey: row.storageKey, contentSha256: row.contentSha256 });
    if (!snapshot) console.error(`[knowledge-storage] READY snapshot artifact missing for website ${websiteId}.`);
    return { snapshot, snapshotId: row.id, storageKey: row.storageKey };
  } catch (error) {
    console.error(`[knowledge-storage] READY snapshot artifact rejected for website ${websiteId}:`, error instanceof Error ? error.message : 'unknown');
    return { snapshot: null, snapshotId: row.id, storageKey: row.storageKey };
  }
}

export { LocalSnapshotStorage, R2SnapshotStorage };
