/**
 * Upload existing local knowledge snapshots to immutable R2 keys without crawling or embedding.
 * Default is dry-run. Use --apply only after reviewing output and configuring R2 credentials.
 */
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prisma } from '../src/db/prisma.js';
import { config } from '../src/config/index.js';
import { getSnapshotStorage, r2SnapshotKey, snapshotSha256 } from '../src/vectorstore/snapshotStorage.js';
import type { KnowledgeSnapshot } from '../src/context/types.js';

const apply = process.argv.includes('--apply');

function valid(snapshot: KnowledgeSnapshot): string | null {
  if (snapshot.version !== 1) return `unsupported version ${snapshot.version}`;
  if (snapshot.embeddingModel !== config.gemini.embeddingModel) return `embedding model mismatch (${snapshot.embeddingModel})`;
  if (!Array.isArray(snapshot.documents) || snapshot.documents.length === 0) return 'snapshot has no chunks';
  if (snapshot.documents.some((chunk) => chunk.embedding.length !== snapshot.dimensions)) return 'embedding dimensions mismatch';
  return null;
}

async function main() {
  if (config.knowledgeStorage !== 'r2') throw new Error('Set KNOWLEDGE_STORAGE=r2 and configure R2 credentials before migrating.');
  const dir = resolve(process.cwd(), config.knowledgeDir);
  const files = (await readdir(dir)).filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
  const storage = getSnapshotStorage('R2');
  let migrated = 0; let skipped = 0;
  for (const file of files) {
    const websiteId = file.slice(0, -5);
    const bytes = await readFile(resolve(dir, file));
    let snapshot: KnowledgeSnapshot;
    try { snapshot = JSON.parse(bytes.toString('utf8')) as KnowledgeSnapshot; } catch { console.warn(`[skip] ${file}: invalid JSON`); skipped++; continue; }
    const reason = valid(snapshot);
    if (reason) { console.warn(`[skip] ${file}: ${reason}`); skipped++; continue; }
    const row = await prisma.knowledgeSnapshot.findFirst({ where: { websiteId, status: 'READY' }, orderBy: { createdAt: 'desc' } });
    if (!row) { console.warn(`[skip] ${file}: no matching READY KnowledgeSnapshot`); skipped++; continue; }
    if (row.chunkCount !== snapshot.documents.length) { console.warn(`[skip] ${file}: database chunk count (${row.chunkCount}) does not match snapshot (${snapshot.documents.length})`); skipped++; continue; }
    if (row.storageProvider === 'R2' && row.contentSha256 === snapshotSha256(bytes)) { console.log(`[skip] ${file}: already migrated`); skipped++; continue; }
    const key = r2SnapshotKey(row.organizationId, websiteId, row.id);
    console.log(`${apply ? '[upload]' : '[dry-run]'} ${file} -> ${key}`);
    if (!apply) continue;
    const artifact = await storage.write(key, bytes);
    if (artifact.contentSha256 !== snapshotSha256(bytes)) throw new Error(`checksum verification failed for ${file}`);
    await prisma.knowledgeSnapshot.update({ where: { id: row.id }, data: { storageProvider: 'R2', storageKey: key, contentSha256: artifact.contentSha256, contentBytes: artifact.contentBytes, etag: artifact.etag } });
    migrated++;
  }
  console.log(`Completed: ${migrated} migrated, ${skipped} skipped${apply ? '' : ' (dry-run; no uploads or DB updates)'}.`);
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
