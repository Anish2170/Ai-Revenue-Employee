/**
 * Website repository — the org-scoped data-access layer.
 *
 * EVERY function requires an `organizationId`. This is the isolation boundary:
 * a caller physically cannot read or mutate a website without naming the org,
 * and mismatched org+id simply returns null (never another tenant's row).
 */
import { prisma } from '../db/prisma.js';
import type { Prisma } from '@prisma/client';
import { getSnapshotStorage, r2SnapshotKey } from '../vectorstore/snapshotStorage.js';
import { websiteSnapshotPath } from '../vectorstore/persistence.js';

export function listWebsites(organizationId: string) {
  return prisma.website.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export function getWebsite(organizationId: string, websiteId: string) {
  return prisma.website.findFirst({
    where: { id: websiteId, organizationId, deletedAt: null },
  });
}

export function createWebsite(organizationId: string, data: Prisma.WebsiteCreateWithoutOrganizationInput) {
  return prisma.website.create({
    data: { ...data, organization: { connect: { id: organizationId } } },
  });
}

export function updateWebsite(
  organizationId: string,
  websiteId: string,
  data: Prisma.WebsiteUpdateInput,
) {
  // updateMany enforces the org scope in the WHERE clause.
  return prisma.website.updateMany({ where: { id: websiteId, organizationId, deletedAt: null }, data });
}

export function deleteWebsite(organizationId: string, websiteId: string) {
  return prisma.$transaction(async (tx) => {
    const websites = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Website" WHERE "id" = ${websiteId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
    if (!websites.length) return { count: 0, siteId: null };
    const widget = await tx.widget.findUnique({ where: { websiteId }, select: { siteId: true } });
    const snapshots = await tx.knowledgeSnapshot.findMany({ where: { organizationId, websiteId } });
    // Include deterministic keys for workers interrupted after upload but before publication.
    const artifacts = new Map<string, { provider: 'LOCAL' | 'R2'; key: string }>();
    artifacts.set('local', { provider: 'LOCAL', key: websiteSnapshotPath(websiteId) });
    for (const snapshot of snapshots) {
      const key = snapshot.storageKey || (snapshot.storageProvider === 'R2' ? r2SnapshotKey(organizationId, websiteId, snapshot.id) : '');
      if (key) artifacts.set(`${snapshot.storageProvider}:${key}`, { provider: snapshot.storageProvider, key });
    }
    for (const { provider, key } of artifacts.values()) await getSnapshotStorage(provider).delete(key);
    await tx.auditLog.deleteMany({ where: { organizationId, OR: [
      { targetType: { in: ['website', 'website_action_override'] }, targetId: websiteId },
      { metadata: { path: ['websiteId'], equals: websiteId } },
    ] } });
    // All website-owned relations cascade, including conversations and their messages.
    const result = await tx.website.deleteMany({ where: { id: websiteId, organizationId } });
    return { ...result, siteId: widget?.siteId ?? null };
  }, { timeout: 60_000 });
}
