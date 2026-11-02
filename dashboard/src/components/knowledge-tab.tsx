'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { KnowledgeState, activeBuild, crawlBudgetForProfile, knowledgeReadyForSetup } from '@/lib/knowledge-state';
import { Button, Card, Badge, Spinner } from '@/components/ui';
import { KnowledgeBuildProgress } from '@/components/knowledge-build-progress';
import { KnowledgeScopeReview } from '@/components/knowledge-scope-review';
import { KnowledgeCrawlDetails } from '@/components/knowledge-crawl-details';
import { CrawlBudgetControls } from '@/components/crawl-budget-controls';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function KnowledgeTab({ websiteId, websiteUrl, onReady }: { websiteId: string; websiteUrl: string; onReady?: () => void }) {
  const [, render] = useState(0);
  const [controller, setController] = useState<KnowledgeState | null>(null);
  const [buildUrl, setBuildUrl] = useState(websiteUrl);
  useEffect(() => {
    const state = new KnowledgeState(api, websiteId, () => render(value => value + 1));
    setController(state); void state.refresh();
    return () => state.stop();
  }, [websiteId]);
  const { status, loading = true, pending, cancelling, connectionLost, error, budgetProfile = 'auto' } = controller?.value ?? {};
  const { maxPages, maxRenderedPages } = crawlBudgetForProfile(budgetProfile);
  const budget = { maxPages, maxRenderedPages };
  const currentBuild = status?.lastBuild;
  const isActive = pending || activeBuild(currentBuild);
  const startBuild = () => { void controller?.start(buildUrl); };
  useEffect(() => {
    if (!loading && !pending && knowledgeReadyForSetup(status)) onReady?.();
  }, [loading, pending, status, onReady]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">Knowledge Base Status</h2>
        {status?.hasKnowledge ? (
          <div className="space-y-2 text-sm">
            <p><Badge variant={['FAILED', 'CANCELLED'].includes(currentBuild?.status) ? 'warning' : 'success'}>{['FAILED', 'CANCELLED'].includes(currentBuild?.status) ? 'Serving previous snapshot — freshness unconfirmed' : isActive ? 'Serving published snapshot while a new build runs' : 'Ready'}</Badge></p>
            <p className="text-[var(--text-muted)]">
              {status.snapshot.pagesCrawled} pages · {status.snapshot.chunkCount} chunks · Model: {status.snapshot.embeddingModel}
            </p>
            <p className="text-[var(--text-muted)]">
              Source: {status.snapshot.sourceUrl}
            </p>
            <p className="text-[var(--text-muted)]">
              Last successful publish: {new Date(status.snapshot.lastSuccessfulPublish ?? status.snapshot.createdAt).toLocaleString()}
            </p>
            <p className="text-[var(--text-muted)]">Active version: {status.snapshot.id}</p>
            {status.snapshot.scopeApproval && <div className="rounded border border-[var(--warning)] p-3 text-[var(--warning)]">
              <p>Approved limited scope is active. All required included sources were indexed; the entire website was not verified.</p>
              <p>Approval: {status.snapshot.scopeApproval.hash} · {new Date(status.snapshot.scopeApproval.approvedAt).toLocaleString()}</p>
              <ul>{status.snapshot.scopeApproval.inventory.filter((entry: AnyRecord) => entry.disposition !== 'required').map((entry: AnyRecord) => <li className="break-all" key={entry.url}>{entry.url} — {entry.disposition}: {entry.reason}</li>)}</ul>
              <p>Facts from omitted pages are unavailable. Missing sources do not establish that a service or policy does not exist.</p>
            </div>}
            <p className="text-[var(--text-muted)]">{status.snapshot.coverage ? 'Published within the recorded public HTML crawl scope; not universal website completeness.' : 'Legacy snapshot: detailed crawl coverage was not recorded.'}</p>
            {status.snapshot.changes && <p className="text-[var(--text-muted)]">{status.snapshot.changes.changed} changed/new sources · {status.snapshot.changes.unchanged} unchanged · {status.snapshot.changes.removed} explicitly gone · {status.snapshot.changes.embeddingsReused} vectors reused</p>}
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-sm">No knowledge base built yet. Crawl your website below to get started.</p>
        )}
      </Card>

      {status?.lastBuild && (
        <Card>
          <h2 className="text-lg font-semibold mb-2">Latest Build</h2>
          <p className="text-sm text-[var(--text-muted)]">{String(status.lastBuild.status).replace('_', ' ')} · {status.lastBuild.phase || 'queued'} · attempt {status.lastBuild.attempt ?? 0}/{status.lastBuild.maxAttempts ?? 3}</p>
          {activeBuild(currentBuild) && <Button variant="secondary" loading={cancelling} disabled={cancelling} onClick={() => void controller?.cancel()}>Cancel refresh</Button>}
          <KnowledgeCrawlDetails key={`details:${websiteId}:${status.lastBuild.id}`} websiteId={websiteId} buildId={status.lastBuild.id} isActive={Boolean(isActive)} />
          {status.lastBuild.error && <p className="mt-2 text-sm text-[var(--danger)]">{status.lastBuild.error}</p>}
          {status.lastBuild.configurationError && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{status.lastBuild.configurationError}</p>}
          {!isActive && <KnowledgeScopeReview key={`scope:${websiteId}:${status.lastBuild.id}`} websiteId={websiteId} buildId={status.lastBuild.id} budget={budget} onQueued={queued => { void controller?.queued(queued.buildId, queued.status); }} />}
        </Card>
      )}

      {/* Build */}
      <Card id="knowledge-rebuild" className="scroll-mt-6">
        <h2 className="text-lg font-semibold mb-4">{status?.hasKnowledge ? 'Rebuild Knowledge' : 'Build Knowledge Base'}</h2>
        <CrawlBudgetControls profile={budgetProfile} disabled={Boolean(isActive)} onChange={profile => controller?.setBudget(profile)} />
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">URL to crawl</label>
            <input
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
              value={buildUrl}
              onChange={(e) => setBuildUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={isActive}
            />
          </div>
          <Button variant="primary" onClick={startBuild} loading={isActive} disabled={isActive || !buildUrl}>
            {isActive ? 'Building…' : status?.hasKnowledge ? 'Rebuild' : 'Start Build'}
          </Button>
        </div>

        {pending && <p role="status">Starting new build…</p>}
        {connectionLost && <Button variant="secondary" onClick={() => void controller?.refresh()}>Retry status connection</Button>}
        {error && <p className="text-[var(--danger)] text-sm mt-3">{error}</p>}

        {currentBuild && <KnowledgeBuildProgress build={currentBuild} connectionLost={connectionLost} />}

      </Card>
    </div>
  );
}
