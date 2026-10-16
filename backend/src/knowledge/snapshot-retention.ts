import { prisma } from '../db/prisma.js';
import { getSnapshotStorage, loadSnapshotArtifact } from '../vectorstore/snapshotStorage.js';

/** Only prune immutable R2 snapshots after a usable replacement has been published. */
export async function pruneKnowledgeSnapshots(organizationId: string, websiteId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    // Serialize with uploads, website deletion, and cleanup from another worker.
    const websites = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Website" WHERE "id" = ${websiteId}::uuid AND "organizationId" = ${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
    if (!websites.length) return 0;
    const snapshots = await tx.knowledgeSnapshot.findMany({
      where: { organizationId, websiteId, status: 'READY', storageProvider: 'R2' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const retained = snapshots.slice(0, 3);
    const obsolete = snapshots.slice(3);
    if (!obsolete.length) return 0;
    const latest = retained[0]!;
    // A missing/corrupt replacement must never cause older backups to be removed.
    const replacement = await loadSnapshotArtifact({ provider: 'R2', storageKey: latest.storageKey, contentSha256: latest.contentSha256 });
    if (!replacement?.documents?.length) throw new Error('Snapshot retention skipped: latest snapshot is not readable.');
    const retainedKeys = new Set(retained.map(snapshot => snapshot.storageKey));
    let removed = 0;
    for (const snapshot of obsolete) {
      // Do not touch shared keys or unexpected paths, even if metadata is malformed.
      const prefix = `knowledge/v1/org/${organizationId}/website/${websiteId}/snapshot/`;
      if (!snapshot.storageKey.startsWith(prefix) || retainedKeys.has(snapshot.storageKey)) continue;
      await getSnapshotStorage('R2').delete(snapshot.storageKey);
      await tx.knowledgeSnapshot.delete({ where: { id: snapshot.id } });
      removed++;
    }
    return removed;
  }, { timeout: 60_000 });
}

/** Cleanup failure must not turn a successful knowledge build into a failed build. */
export async function cleanupKnowledgeSnapshots(organizationId: string, websiteId: string): Promise<void> {
  try {
    await pruneKnowledgeSnapshots(organizationId, websiteId);
  } catch {
    console.warn('[knowledge-worker] snapshot cleanup deferred; it will retry after the next successful build.');
  }
}
