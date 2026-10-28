import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = ''; process.env.GEMINI_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.DEBUG_TRACE = 'false';
const { ingest, IncompleteBuildError } = await import('../services/ingestService.js');
const { onboardingFixture, fixtureOrigin } = await import('./phase45Fixtures.js');
const embed = async (chunks: any[]) => chunks.map(chunk => ({ ...chunk, embedding: [1, 0] }));
const write = async (snapshot: any) => ({ provider: 'LOCAL' as const, storageKey: 'fixture', contentSha256: 'fixture', contentBytes: JSON.stringify(snapshot).length, etag: null });

test('baseline: fifty useful pages are honestly incomplete under unchanged default', async () => {
  const result = await onboardingFixture(50).crawl();
  assert.equal(result.manifest.attempted, 25); assert.equal(result.manifest.discovered, 50);
  assert.equal(result.manifest.completeWithinScope, false); assert.equal(result.manifest.entries.filter(e => e.state === 'pending').length, 25);
});
test('owner bounded budget reaches ingestion instead of being discarded', async () => {
  const fixture = onboardingFixture(50);
  const result = await ingest(fixtureOrigin, { websiteId: 'budget', organizationId: 'org', snapshotId: 'budget', crawlBudget: { maxPages: 50, maxRenderedPages: 3 } } as any,
    { previous: async () => null, crawl: async (_url, opts) => fixture.crawl(opts), embed, write });
  assert.equal(result.pages, 50); assert.equal(result.snapshot.crawlManifest!.attempted, 50);
});
test('five dynamic service pages can use an explicit five-render budget', async () => {
  const fixture = onboardingFixture(6, undefined, true);
  const result = await ingest(fixtureOrigin, { websiteId: 'dynamic-budget', organizationId: 'org', snapshotId: 'dynamic-budget', crawlBudget: { maxPages: 25, maxRenderedPages: 5 } } as any,
    { previous: async () => null, crawl: async (_url, opts) => fixture.crawl(opts), embed, write });
  assert.equal(result.snapshot.crawlManifest!.rendered, 5); assert.equal(result.pages, 6);
});
test('manifest reports the configured render budget for owner review', async () => {
  const result = await onboardingFixture().crawl({ maxRenderedPages: 5 });
  assert.equal((result.manifest as any).maxRenderedPages, 5);
});
for (const failed of ['/blog/old-update', '/refund']) test(`baseline strict failure remains visible: ${failed}`, async () => {
  const fixture = onboardingFixture(5, failed); let embedded = 0;
  await assert.rejects(ingest(fixtureOrigin, { websiteId: failed, organizationId: 'org', snapshotId: 'x' }, {
    previous: async () => null, crawl: async () => fixture.crawl(), embed: async chunks => { embedded++; return embed(chunks); }, write,
  }), IncompleteBuildError);
  assert.equal(embedded, 0);
});
test('initial robots-blocked refund source must block publication without requesting it', async () => {
  const fixture = onboardingFixture(), original = fixture.deps.fetch!; let embeddings = 0;
  fixture.deps.fetch = async (url, options) => new URL(url).pathname === '/robots.txt' ? { url, status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('User-agent: *\nDisallow: /refund') } : original(url, options);
  await assert.rejects(ingest(fixtureOrigin, { websiteId: 'robots-initial', organizationId: 'org', snapshotId: 'robots' }, {
    previous: async () => null, crawl: async () => fixture.crawl(), embed: async chunks => { embeddings++; return embed(chunks); }, write,
  }), IncompleteBuildError);
  assert.equal(embeddings, 0); assert.ok(!fixture.calls.includes('/refund'));
});
