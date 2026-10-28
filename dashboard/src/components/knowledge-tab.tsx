'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { KnowledgeState, activeBuild } from '@/lib/knowledge-state';
import { Button, Card, Badge, Spinner } from '@/components/ui';
import { KnowledgeBuildProgress } from '@/components/knowledge-build-progress';
import { KnowledgeScopeReview } from '@/components/knowledge-scope-review';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export function KnowledgeTab({ websiteId, websiteUrl }: { websiteId: string; websiteUrl: string }) {
  const [, render] = useState(0);
  const [controller, setController] = useState<KnowledgeState | null>(null);
  const [buildUrl, setBuildUrl] = useState(websiteUrl);
  const [manifest, setManifest] = useState<AnyRecord | null>(null);
  const [detailError, setDetailError] = useState('');
  const [detailBuildId, setDetailBuildId] = useState('');
  const detailRequest = useRef(0);
  useEffect(() => {
    const state = new KnowledgeState(api, websiteId, () => render(value => value + 1), () => undefined as unknown as ReturnType<typeof setTimeout>);
    setController(state); void state.refresh();
    return () => state.stop();
  }, [websiteId]);
  const { status, loading = true, pending, cancelling, connectionLost, error, budgetProfile = '25:3' } = controller?.value ?? {};
  const [maxPages, maxRenderedPages] = budgetProfile.split(':').map(Number);
  const budget = { maxPages, maxRenderedPages };
  const currentBuild = status?.lastBuild;
  const isActive = pending || activeBuild(currentBuild);
  const startBuild = () => { setManifest(null); setDetailError(''); void controller?.start(buildUrl); };
  useEffect(() => { detailRequest.current++; setManifest(null); setDetailError(''); }, [currentBuild?.id]);
  const fetchManifest = async () => {
    const request = ++detailRequest.current, buildId = currentBuild?.id;
    try {
      const result = await api.getKnowledgeManifest(websiteId, buildId);
      if (request !== detailRequest.current) return;
      setDetailBuildId(buildId); setDetailError(''); setManifest(result as AnyRecord);
    } catch {
      if (request === detailRequest.current) { setDetailBuildId(buildId); setDetailError('Crawl details are not available yet.'); }
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <p role="alert">Recovery mode: knowledge processing and dashboard changes are paused. Serving retained published knowledge with its original scope limitations. Job status is the last confirmed state; use Refresh retained status to read again.</p>
      <Button variant="secondary" onClick={() => void controller?.refresh()}>Refresh retained status</Button>
      {/* Current Status */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">Knowledge Base Status</h2>
        {status?.hasKnowledge ? (
          <div className="space-y-2 text-sm">
            <p><Badge variant={['FAILED', 'CANCELLED'].includes(currentBuild?.status) ? 'warning' : 'success'}>{['FAILED', 'CANCELLED'].includes(currentBuild?.status) ? 'Serving previous snapshot — freshness unconfirmed' : isActive ? 'Serving retained published snapshot — recovery mode' : 'Ready'}</Badge></p>
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
          <Button variant="secondary" onClick={() => void fetchManifest()}>View crawl details</Button>
          {manifest && detailBuildId === currentBuild?.id && <details open className="mt-3 text-xs"><summary>Per-URL crawl outcomes ({manifest.entries?.length ?? 0})</summary><ul>{(manifest.entries ?? []).slice(0,100).map((entry:AnyRecord,index:number)=><li key={index} className="mt-1 break-all">{entry.url} — {entry.state}{entry.reason ? ` (${entry.reason})` : ''}</li>)}</ul>{manifest.entries?.length>100 && <p>Showing the first 100 outcomes.</p>}</details>}
          {status.lastBuild.error && <p className="mt-2 text-sm text-[var(--danger)]">{status.lastBuild.error}</p>}
          {status.lastBuild.configurationError && <p role="alert" className="mt-2 text-sm text-[var(--danger)]">{status.lastBuild.configurationError}</p>}
        </Card>
      )}

      {/* Build */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">{status?.hasKnowledge ? 'Rebuild Knowledge' : 'Build Knowledge Base'}</h2>
        <label className="mb-4 block text-sm">Crawl budget
          <select aria-label="Crawl budget" className="ml-3 rounded border border-[var(--border)] bg-[var(--bg)] p-2" value={budgetProfile} disabled={true} onChange={event => controller?.setBudget(event.target.value)}>
            {!['25:3','50:5','100:8','50:0'].includes(budgetProfile) && <option value={budgetProfile}>Saved — {maxPages} pages / {maxRenderedPages} renders</option>}
            <option value="25:3">Standard — 25 pages / 3 renders</option>
            <option value="50:5">Larger — 50 pages / 5 renders</option>
            <option value="100:8">Extended — 100 pages / 8 renders</option>
            <option value="50:0">Static HTML — 50 pages / no renders</option>
          </select>
        </label>
        <p className="mb-4 text-xs text-[var(--text-muted)]">Maximum attempts, including failed pages. Request, text and time limits still apply. Larger budgets may take longer. If important pages fail, publication stays blocked. The same budget applies to a reviewed rebuild.</p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">URL to crawl</label>
            <input
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
              value={buildUrl}
              onChange={(e) => setBuildUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={true}
            />
          </div>
          <Button variant="primary" disabled={true}>Knowledge builds paused</Button>
        </div>

        {activeBuild(currentBuild) && <p role="status">Processing is paused in this recovery build; the persisted job status above is historical.</p>}
        {pending && <p role="status">Starting new build…</p>}
        {connectionLost && <Button variant="secondary" onClick={() => void controller?.refresh()}>Retry status connection</Button>}
        {detailError && detailBuildId === currentBuild?.id && <p role="alert">{detailError}</p>}
        {error && <p className="text-[var(--danger)] text-sm mt-3">{error}</p>}

        {currentBuild && !activeBuild(currentBuild) && <KnowledgeBuildProgress build={currentBuild} connectionLost={connectionLost} />}

      </Card>
    </div>
  );
}

