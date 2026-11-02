import { Prisma, type PrismaClient } from '@prisma/client';
import { join, resolve } from 'node:path';
import { prisma } from '../db/prisma.js';
import type { KnowledgeSnapshot } from '../context/types.js';
import { validateKnowledgeSnapshot } from '../knowledge/publication.js';
import { getSnapshotStorage, r2SnapshotKey, serializeSnapshot, snapshotSha256, type SnapshotStorage } from '../vectorstore/snapshotStorage.js';
import { websiteSnapshotPath } from '../vectorstore/persistence.js';
import { invalidateWebsiteStore } from '../vectorstore/registry.js';
import { invalidateTenantCacheForWebsite } from '../tenant/tenant.resolver.js';
import { normalizeUrl } from '../crawler/links.js';
import { REFRESH_AUDIT_ACTION } from './actionRefreshPins.js';
import { ActionRefreshError, identitySchema, preservedKnowledgeDigest, refreshFence,
  type RefreshIdentity, type RefreshRepository, type RefreshSnapshotRow, type RefreshState } from './actionRefresh.js';

type MetaState = Omit<RefreshState, 'snapshot'>;
type Db = Pick<PrismaClient, '$transaction'>;
const ACTIVE = ['QUEUED', 'RUNNING', 'RETRY_WAIT'] as const;
function snapshotRow(row: NonNullable<Awaited<ReturnType<Prisma.TransactionClient['knowledgeSnapshot']['findFirst']>>>): RefreshSnapshotRow {
  if (!row.storageKey || !row.contentSha256 || !row.contentBytes) throw new ActionRefreshError('UNVERIFIED_SNAPSHOT');
  return { id: row.id, organizationId: row.organizationId, websiteId: row.websiteId, storageProvider: row.storageProvider,
    storageKey: row.storageKey, contentSha256: row.contentSha256, contentBytes: row.contentBytes, sourceUrl: row.sourceUrl,
    embeddingModel: row.embeddingModel, dimensions: row.dimensions, pagesCrawled: row.pagesCrawled, chunkCount: row.chunkCount, createdAt: row.createdAt.toISOString() };
}
function versionKey(row: Pick<RefreshSnapshotRow, 'storageProvider' | 'organizationId' | 'websiteId'>, id: string) {
  return row.storageProvider === 'R2' ? r2SnapshotKey(row.organizationId, row.websiteId, id) : join(websiteSnapshotPath(row.websiteId) + '.versions', id + '.json');
}

export function createActionRefreshRepository(options: { db?: Db; storage?: typeof getSnapshotStorage; now?: () => number;
  invalidate?: (websiteId: string) => void } = {}): RefreshRepository {
  const db = options.db ?? prisma, storage = options.storage ?? getSnapshotStorage, now = options.now ?? Date.now;
  const invalidate = options.invalidate ?? (websiteId => { invalidateWebsiteStore(websiteId); invalidateTenantCacheForWebsite(websiteId); });

  async function inspect(tx: Prisma.TransactionClient, identity: RefreshIdentity): Promise<MetaState> {
    identitySchema.parse(identity);
    const websites = await tx.$queryRaw<Array<{ id: string; url: string; updatedAt: Date }>>`
      SELECT "id", "url", "updatedAt" FROM "Website" WHERE "id" = ${identity.websiteId}::uuid
      AND "organizationId" = ${identity.organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
    if (websites.length !== 1) throw new ActionRefreshError('WEBSITE_NOT_FOUND');
    const members = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT m."id" FROM "OrganizationMember" m JOIN "User" u ON u."id" = m."userId"
      JOIN "Organization" o ON o."id" = m."organizationId" WHERE m."organizationId" = ${identity.organizationId}::uuid
      AND m."userId" = ${identity.userId}::uuid AND m."role" = 'OWNER' AND u."deletedAt" IS NULL AND o."deletedAt" IS NULL
      FOR SHARE OF m, u, o`;
    if (members.length !== 1) throw new ActionRefreshError('OWNER_REQUIRED');
    const where = { websiteId: identity.websiteId, organizationId: identity.organizationId };
    if (await tx.knowledgeBuild.count({ where: { ...where, status: { in: [...ACTIVE] } } })) throw new ActionRefreshError('BUILD_ACTIVE');
    const row = await tx.knowledgeSnapshot.findFirst({ where: { ...where, status: 'READY' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    if (!row) throw new ActionRefreshError('NO_PUBLISHED_SNAPSHOT');
    const latestBuild = await tx.knowledgeBuild.findFirst({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, snapshotId: true, status: true, updatedAt: true } });
    const overrides = await tx.actionUrlOverride.findMany({ where, orderBy: [{ intent: 'asc' }, { id: 'asc' }], select: { id: true, intent: true, url: true, updatedAt: true } });
    return { identity, website: { url: websites[0].url, revision: websites[0].updatedAt.toISOString() }, row: snapshotRow(row), latestBuild,
      overrides: overrides.map(row => ({ ...row, updatedAt: row.updatedAt.toISOString() })) };
  }
  async function metadata(identity: RefreshIdentity) {
    return db.$transaction(tx => inspect(tx, identity), { timeout: 15000 });
  }
  function validate(snapshot: KnowledgeSnapshot, row: RefreshSnapshotRow, websiteUrl: string) {
    validateKnowledgeSnapshot(snapshot);
    if (snapshot.publication && snapshot.publication.id !== row.id || snapshot.sourceUrl !== row.sourceUrl
      || normalizeUrl(snapshot.sourceUrl) !== normalizeUrl(websiteUrl)
      || snapshot.embeddingModel !== row.embeddingModel || snapshot.dimensions !== row.dimensions
      || snapshot.documents.length !== row.chunkCount || snapshot.pages.length !== row.pagesCrawled
      || snapshot.scopeApproval && (snapshot.scopeApproval.organizationId !== row.organizationId || snapshot.scopeApproval.websiteId !== row.websiteId))
      throw new ActionRefreshError('SNAPSHOT_IDENTITY_MISMATCH');
  }
  async function read(row: RefreshSnapshotRow, websiteUrl: string): Promise<KnowledgeSnapshot> {
    const expected = versionKey(row, row.id);
    if (row.storageProvider === 'R2' ? row.storageKey !== expected
      : ![resolve(expected), resolve(websiteSnapshotPath(row.websiteId))].includes(resolve(row.storageKey))) throw new ActionRefreshError('SNAPSHOT_TENANT_KEY_MISMATCH');
    const artifact = await storage(row.storageProvider).read(row.storageKey);
    if (!artifact || artifact.bytes.length !== row.contentBytes || snapshotSha256(artifact.bytes) !== row.contentSha256) throw new ActionRefreshError('SNAPSHOT_INTEGRITY_FAILED');
    let snapshot: KnowledgeSnapshot;
    try { snapshot = JSON.parse(artifact.bytes.toString('utf8')); validate(snapshot, row, websiteUrl); }
    catch { throw new ActionRefreshError('SNAPSHOT_INTEGRITY_FAILED'); }
    return snapshot;
  }
  async function load(identity: RefreshIdentity): Promise<RefreshState> {
    const meta = await metadata(identity);
    return { ...meta, snapshot: await read(meta.row, meta.website.url) };
  }
  return {
    load,
    async readParent(state, id) {
      // Tenant-qualified lookup even when an artifact's parent field is damaged.
      const row = await db.$transaction(async tx => {
        const current = await inspect(tx, state.identity);
        if (refreshFence({ ...current, snapshot: state.snapshot }) !== refreshFence(state)) throw new ActionRefreshError('STALE_REFRESH_PLAN');
        const parent = await tx.knowledgeSnapshot.findFirst({ where: { id, websiteId: state.identity.websiteId, organizationId: state.identity.organizationId, status: 'READY' } });
        if (!parent) throw new ActionRefreshError('ROLLBACK_SNAPSHOT_NOT_FOUND');
        return snapshotRow(parent);
      }, { timeout: 15000 });
      return read(row, state.website.url);
    },
    async publish(state, snapshot, operation, reviewDigest, expiresAt) {
      if (refreshFence(await load(state.identity)) !== refreshFence(state)) throw new ActionRefreshError('STALE_REFRESH_PLAN');
      const id = snapshot.publication?.id;
      if (!id || id === state.row.id || snapshot.actionRefresh?.parentSnapshotId !== state.row.id
        || snapshot.actionRefresh.operation !== operation || snapshot.actionRefresh.reviewDigest !== reviewDigest
        || preservedKnowledgeDigest(snapshot) !== preservedKnowledgeDigest(state.snapshot)) throw new ActionRefreshError('INVALID_ACTION_VERSION');
      const key = versionKey(state.row, id), bytes = serializeSnapshot(snapshot), sha = snapshotSha256(bytes);
      const row: RefreshSnapshotRow = { ...state.row, id, storageKey: key, contentSha256: sha, contentBytes: bytes.length };
      validate(snapshot, row, state.website.url);
      if (Date.parse(expiresAt) <= now()) throw new ActionRefreshError('EXPIRED_REFRESH_PLAN');
      // No READY bytes are ever overwritten. Failed publication leaves only an
      // inactive immutable artifact; this tool deliberately has no delete path.
      const store: SnapshotStorage = storage(state.row.storageProvider);
      const artifact = await store.write(key, bytes);
      if (artifact.provider !== row.storageProvider || artifact.storageKey !== key || artifact.contentSha256 !== sha || artifact.contentBytes !== bytes.length)
        throw new ActionRefreshError('UPLOAD_INTEGRITY_FAILED');
      const verified = await read(row, state.website.url);
      if (preservedKnowledgeDigest(verified) !== preservedKnowledgeDigest(state.snapshot)) throw new ActionRefreshError('KNOWLEDGE_CHANGED');

      await db.$transaction(async tx => {
        // Enqueue and normal knowledge publication use this same website lock.
        // SHARE blocks override inserts as well as updates while comparing and
        // activating. No network request is performed inside this transaction.
        const current = await inspect(tx, state.identity);
        await tx.$executeRaw`LOCK TABLE "ActionUrlOverride" IN SHARE MODE`;
        const locked = await inspect(tx, state.identity);
        if (refreshFence({ ...current, snapshot: state.snapshot }) !== refreshFence(state)
          || refreshFence({ ...locked, snapshot: state.snapshot }) !== refreshFence(state)) throw new ActionRefreshError('STALE_REFRESH_PLAN');
        if (Date.parse(expiresAt) <= now()) throw new ActionRefreshError('EXPIRED_REFRESH_PLAN');
        await tx.knowledgeSnapshot.create({ data: {
          id, websiteId: state.identity.websiteId, organizationId: state.identity.organizationId,
          status: 'READY', storageProvider: row.storageProvider, storageKey: key, contentSha256: sha, contentBytes: bytes.length, etag: artifact.etag,
          sourceUrl: row.sourceUrl, embeddingModel: row.embeddingModel, dimensions: row.dimensions, pagesCrawled: row.pagesCrawled, chunkCount: row.chunkCount,
          // Readers sort by createdAt. Ensure a strictly newer version even on
          // same-millisecond publications or a slightly skewed process clock.
          createdAt: new Date(Math.max(now(), Date.parse(state.row.createdAt) + 1)),
        } });
        await tx.auditLog.create({ data: { organizationId: state.identity.organizationId, userId: state.identity.userId,
          action: REFRESH_AUDIT_ACTION, targetType: 'website', targetId: state.identity.websiteId,
          metadata: { version: 1, operation, previousSnapshotId: state.row.id, newSnapshotId: id, reviewDigest,
            previousSha256: state.row.contentSha256, newSha256: sha, knowledgeDigest: preservedKnowledgeDigest(snapshot) } satisfies Prisma.InputJsonObject,
        } });
      }, { timeout: 15000 });
      let cachesRefreshed = true;
      try { invalidate(state.identity.websiteId); } catch { cachesRefreshed = false; }
      return { snapshotId: id, previousSnapshotId: state.row.id, contentSha256: sha, operation, cachesRefreshed };
    },
  };
}
