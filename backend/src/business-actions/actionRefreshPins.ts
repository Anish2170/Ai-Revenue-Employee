/** Audit entries are written atomically with action-only READY versions. No TTL:
 * automatic retention must never consume their rollback chain. */
export const REFRESH_AUDIT_ACTION = 'website_actions.snapshot_published';
export function protectedActionSnapshotIds(rows: Array<{ metadata: unknown }>): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    const metadata = row.metadata as { previousSnapshotId?: unknown; newSnapshotId?: unknown; version?: unknown } | null;
    if (!metadata || metadata.version !== 1 || typeof metadata.previousSnapshotId !== 'string' || typeof metadata.newSnapshotId !== 'string')
      throw Error('Snapshot retention skipped: action-refresh rollback pins are invalid.');
    ids.add(metadata.previousSnapshotId); ids.add(metadata.newSnapshotId);
  }
  return ids;
}
