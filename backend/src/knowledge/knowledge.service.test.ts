import assert from 'node:assert/strict';
import test from 'node:test';
import type { CrawlManifest } from '../crawler/crawlManifest.js';

process.env.DATABASE_URL = '';
process.env.GEMINI_API_KEY = '';
const websiteId = 'crawl-details-regression';
const sourceUrl = 'https://fixture.invalid/';
let bytes: Buffer;
let checksum: string;
// In-memory models keep this regression independent of real tenant data.
(globalThis as any).prisma = {
  website: { async findFirst() { return { url: sourceUrl, updatedAt: new Date('2026-11-02') }; } },
  knowledgeBuild: { async findFirst() { return { id: 'build', snapshotId: 'snapshot', status: 'SUCCESS', sourceUrl }; } },
  knowledgeSnapshot: { async findFirst() { return { id: 'snapshot', storageKey: 'fixture', storageProvider: 'LOCAL', contentSha256: checksum }; } },
};
const { getBuildManifest, getScopeReview } = await import('./knowledge.service.js');
const { ScopeError } = await import('./crawlScope.js');
const { setSnapshotStorageForTests, snapshotSha256 } = await import('../vectorstore/snapshotStorage.js');
const manifest: CrawlManifest = {
  version: 1, scope: 'public HTML', startedAt: '', finishedAt: '', maxPages: 25, maxRenderedPages: 3,
  maxDepth: 3, maxRequests: 100, networkRequests: 1, discovered: 1, attempted: 1, fetched: 1, useful: 1,
  rendered: 0, duplicates: 0, failed: 0, skipped: 0, completeWithinScope: true, limits: [],
  categoriesFetched: ['home'], discoveredCategoriesNotFetched: [],
  entries: [{ url: sourceUrl, depth: 0, category: 'home', state: 'fetched' }],
};
function artifact(value: object) {
  bytes = Buffer.from(JSON.stringify(value)); checksum = snapshotSha256(bytes);
  setSnapshotStorageForTests({ provider: 'LOCAL', async read() { return { bytes, etag: null }; },
    async write() { throw Error('Unexpected write'); }, async delete() { throw Error('Unexpected delete'); } });
}
test.after(() => setSnapshotStorageForTests(null));

test('legacy artifact without a manifest returns actionable scope guidance instead of identity error', async () => {
  artifact({ sourceUrl });
  assert.equal(await getBuildManifest('org', websiteId, 'build'), null);
  await assert.rejects(getScopeReview('org', websiteId, 'build'), (error: unknown) => {
    assert.ok(error instanceof ScopeError);
    assert.equal(error.code, 'crawl_inventory_unavailable');
    assert.match(error.message, /Rebuild knowledge/);
    return true;
  });
});
test('recorded crawl details and protected scope review remain available', async () => {
  artifact({ sourceUrl, publication: { id: 'snapshot' }, crawlManifest: manifest });
  assert.deepEqual(await getBuildManifest('org', websiteId, 'build'), manifest);
  const review = await getScopeReview('org', websiteId, 'build');
  assert.equal(review.entries.length, 1);
  assert.equal(review.entries[0].exclusionBlockReason, 'Connected start page is required.');
  assert.match(review.hash, /^[a-f0-9]{64}$/);
});
test('recorded artifacts with the wrong identity still cannot be reviewed', async () => {
  artifact({ sourceUrl, publication: { id: 'other-snapshot' }, crawlManifest: manifest });
  await assert.rejects(getScopeReview('org', websiteId, 'build'), /Invalid review artifact identity/);
});
test('legacy guidance does not bypass checksum validation', async () => {
  artifact({ sourceUrl }); checksum = 'wrong-checksum';
  await assert.rejects(getScopeReview('org', websiteId, 'build'), /integrity check failed/);
});
