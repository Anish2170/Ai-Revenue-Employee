import assert from 'node:assert/strict';
import test from 'node:test';
process.env.DATABASE_URL = ''; process.env.GEMINI_API_KEY = ''; process.env.OPENAI_API_KEY = '';
const { onboardingFixture, fixtureOrigin } = await import('../knowledge/phase45Fixtures.js');
const { autoCrawlBudget, crawlBudgetSchema, manualCrawlBudgetSchema } = await import('../knowledge/crawlScope.js');
const { ingest, IncompleteBuildError } = await import('../services/ingestService.js');

for (const [count, allowance] of [[5, 25], [38, 50], [75, 100]] as const) {
  test(`Auto completes ${count} pages in one crawl without refetching earlier pages`, async () => {
    const fixture = onboardingFixture(count);
    const result = await fixture.crawl(autoCrawlBudget());
    assert.equal(result.pages.length, count);
    assert.equal(result.manifest.completeWithinScope, true);
    assert.equal(result.manifest.maxPages, allowance);
    assert.equal(result.manifest.budgetMode, 'auto');
    const pageCalls = fixture.calls.filter(path => !['/robots.txt', '/sitemap.xml'].includes(path));
    assert.equal(pageCalls.length, count);
    assert.equal(new Set(pageCalls).size, count);
    assert.deepEqual(result.manifest.budgetSteps?.map(step => step.maxPages), allowance === 25 ? [25] : allowance === 50 ? [25, 50] : [25, 50, 100]);
  });
}
test('Auto never exceeds 100 page attempts and leaves oversized sites incomplete', async () => {
  const fixture = onboardingFixture(130), result = await fixture.crawl(autoCrawlBudget());
  assert.equal(result.manifest.attempted, 100);
  assert.equal(result.pages.length, 100);
  assert.ok(result.manifest.limits.includes('page_budget'));
  assert.equal(result.manifest.completeWithinScope, false);
  assert.equal(result.manifest.entries.filter(entry => entry.state === 'pending').length, 30);
});
for (const [dynamicPages, expectedRenders, complete] of [[5, 5, true], [8, 8, true], [9, 8, false]] as const) {
  test(`Auto render expansion respects the eight-render ceiling for ${dynamicPages} dynamic pages`, async () => {
    const fixture = onboardingFixture(dynamicPages + 1, undefined, true), result = await fixture.crawl(autoCrawlBudget());
    assert.equal(result.manifest.rendered, expectedRenders);
    assert.equal(result.manifest.completeWithinScope, complete);
    if (!complete) assert.ok(result.manifest.entries.some(entry => entry.reason === 'render_budget'));
  });
}
test('explicit manual Standard and Static HTML limits are never increased', async () => {
  const standard = await onboardingFixture(38).crawl({ mode: 'manual', maxPages: 25, maxRenderedPages: 3 });
  assert.equal(standard.manifest.attempted, 25); assert.equal(standard.manifest.completeWithinScope, false);
  const staticOnly = await onboardingFixture(6, undefined, true).crawl({ mode: 'manual', maxPages: 50, maxRenderedPages: 0 });
  assert.equal(staticOnly.manifest.rendered, 0); assert.equal(staticOnly.manifest.completeWithinScope, false);
});
test('Auto cannot approve a failed required source or bypass its shared request budget', async () => {
  const failed = await onboardingFixture(38, '/refund').crawl(autoCrawlBudget());
  assert.equal(failed.manifest.completeWithinScope, false);
  assert.ok(failed.manifest.entries.some(entry => entry.url.endsWith('/refund') && entry.state === 'failed'));
  const fixture = onboardingFixture(75), limited = await fixture.crawl({ ...autoCrawlBudget(), maxRequests: 8 });
  assert.equal(limited.manifest.networkRequests, 8); assert.equal(fixture.calls.length, 8);
  assert.equal(limited.manifest.completeWithinScope, false);
});
test('Auto shares one cancellation/deadline across all growth steps', async () => {
  const fixture = onboardingFixture(75), original = fixture.deps.fetch!;
  fixture.deps.fetch = async (...args) => { await new Promise(resolve => setTimeout(resolve, 5)); return original(...args); };
  const result = await fixture.crawl({ ...autoCrawlBudget(), maxDurationMs: 1 });
  assert.equal(result.manifest.completeWithinScope, false);
  assert.ok(result.manifest.limits.includes('deadline_or_cancelled'));
  assert.ok(result.manifest.attempted < 25);
});
test('Auto has fixed validated ceilings; reviewed scopes remain fixed', () => {
  assert.equal(crawlBudgetSchema.safeParse(autoCrawlBudget()).success, true);
  assert.equal(manualCrawlBudgetSchema.safeParse(autoCrawlBudget()).success, false);
  assert.equal(crawlBudgetSchema.safeParse({ mode: 'auto', maxPages: 1000, maxRenderedPages: 100 }).success, false);
  assert.equal(crawlBudgetSchema.safeParse({ mode: 'auto', maxPages: 25, maxRenderedPages: 3 }).success, false);
});
test('Auto expands before embedding, and an oversized crawl performs zero embedding work', async () => {
  for (const count of [38, 130]) {
    let embeddingCalls = 0;
    const fixture = onboardingFixture(count);
    const result = ingest(fixtureOrigin, { websiteId: `auto-${count}`, organizationId: 'fixture', snapshotId: 'candidate', crawlBudget: autoCrawlBudget() }, {
      previous: async () => null, crawl: async (_url, options) => fixture.crawl(options),
      embed: async chunks => { embeddingCalls++; return chunks.map(chunk => ({ ...chunk, embedding: [1, 0] })); },
      write: async snapshot => ({ provider: 'LOCAL', storageKey: 'fixture', contentSha256: 'fixture', contentBytes: JSON.stringify(snapshot).length, etag: null }),
    });
    if (count === 130) { await assert.rejects(result, IncompleteBuildError); assert.equal(embeddingCalls, 0); }
    else { assert.equal((await result).pages, count); assert.equal(embeddingCalls, 1); }
  }
});
