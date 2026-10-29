'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui';

interface Review {
  hash: string;
  sourceUrl: string;
  configuredWebsiteUrl: string;
  limitations: string;
  entries: Array<{ url: string; state: string; category: string; title?: string; reason?: string; exclusionBlockReason: string | null }>;
}
export function KnowledgeScopeReview({ websiteId, buildId, budget, onQueued }: {
  websiteId: string; buildId: string; budget: { maxPages: number; maxRenderedPages: number }; onQueued: (queued: { buildId: string; status: string }) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setAcknowledged(false); }, [budget.maxPages, budget.maxRenderedPages]);
  const load = async () => {
    setBusy(true); setError('');
    try { setReview(await api.getKnowledgeScopeReview(websiteId, buildId) as Review); setExcluded([]); setAcknowledged(false); }
    catch (err) { setError(err instanceof Error ? err.message : 'Scope review is unavailable.'); }
    finally { setBusy(false); }
  };
  const approve = async () => {
    if (!review) return;
    setBusy(true); setError('');
    try {
      const queued = await api.approveKnowledgeScope(websiteId, buildId, { reviewHash: review.hash, excludedUrls: excluded, reason, acknowledgeLimitations: true, budget });
      setReview(null); onQueued(queued as { buildId: string; status: string });
    } catch (err) { setError(err instanceof Error ? err.message : 'Approval failed. Reload the review.'); }
    finally { setBusy(false); }
  };
  return <div className="mt-4 space-y-3 text-sm">
    <Button variant="secondary" onClick={load} disabled={busy}>Review a limited crawl scope</Button>
    {review && <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
      <h3 className="font-semibold">Review included and excluded sources</h3>
      <p className="break-all">Connected website: {review.configuredWebsiteUrl} · Start page: {review.sourceUrl}</p>
      <p>{review.limitations}</p>
      <p>{review.entries.length} recorded URLs · {excluded.length} owner exclusions · Budget: {budget.maxPages} HTML attempts / {budget.maxRenderedPages} browser renders.</p>
      <p>Every remaining useful HTML page is required. Previously published sources and potentially critical policy, pricing, service and booking pages cannot be excluded here. URL categories are hints, not verified authority.</p>
      <details open><summary>Source inventory and outcomes</summary>
        <ul className="mt-2 max-h-96 space-y-3 overflow-y-auto">
          {review.entries.map(entry => <li key={entry.url} className="break-all">
            <label className="flex items-start gap-2">
              <input type="checkbox" aria-label={`Exclude ${entry.url}`} disabled={Boolean(entry.exclusionBlockReason) || busy} checked={excluded.includes(entry.url)}
                onChange={event => { setExcluded(current => event.target.checked ? [...current, entry.url] : current.filter(url => url !== entry.url)); setAcknowledged(false); }} />
              <span>{entry.url} — {entry.state}{entry.reason ? ` (${entry.reason})` : ''} · {entry.category}
                <br />{excluded.includes(entry.url) ? 'Owner-excluded: no facts from this source will be available.' : entry.exclusionBlockReason ?? 'Included by default. Exclude only after confirming this is an optional blog/news source.'}</span>
            </label>
          </li>)}
        </ul>
      </details>
      <label className="block">Why are these pages optional?
        <textarea className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2" value={reason} maxLength={500} onChange={event => { setReason(event.target.value); setAcknowledged(false); }} />
      </label>
      <p className="text-[var(--warning)]">Excluded pages may contain information the assistant will not know. Missing information does not mean a service or policy does not exist. This review cannot resolve contradictory facts. Required external CDN scripts remain unsupported; provide public, server-rendered HTML or same-origin resources.</p>
      <label className="flex items-start gap-2"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
        I confirm these exclusions are optional and accept the listed knowledge limitations. I approve a new build with the displayed budget and source inventory. Any new source requires another review.</label>
      <Button variant="primary" onClick={approve} disabled={busy || !acknowledged || !excluded.length || reason.trim().length < 12}>Approve limited scope and rebuild</Button>
      <p className="text-xs text-[var(--text-muted)]">Approval is valid for this build for 24 hours. Current organization owner permission is checked again at publication. A failed build retains any previous usable snapshot.</p>
    </div>}
    {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
  </div>;
}
