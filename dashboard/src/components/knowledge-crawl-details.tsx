'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui';

interface Manifest {
  entries: Array<{ url: string; state: string; reason?: string }>;
}

export function KnowledgeCrawlDetails({ websiteId, buildId, isActive }: { websiteId: string; buildId: string; isActive: boolean }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);

  const load = async () => {
    const generation = ++request.current;
    setBusy(true); setError(''); setUnavailable(false); setManifest(null);
    try {
      const result = await api.getKnowledgeManifest(websiteId, buildId) as Manifest;
      if (generation === request.current) setManifest(result);
    } catch (err) {
      if (generation !== request.current) return;
      if (err instanceof ApiError && err.code === 'manifest_not_available') setUnavailable(true);
      else setError(err instanceof Error ? err.message : 'Unable to load crawl details. Try again.');
    } finally { if (generation === request.current) setBusy(false); }
  };

  return <div className="mt-3 space-y-3 text-sm">
    <Button variant="secondary" loading={busy} onClick={() => void load()}>View crawl details</Button>
    {manifest && <details open className="text-xs">
      <summary>Per-URL crawl outcomes ({manifest.entries.length})</summary>
      {manifest.entries.length === 0 && <p>No URL outcomes were recorded for this build.</p>}
      <ul>{manifest.entries.slice(0, 100).map((entry, index) => <li key={index} className="mt-1 break-all">{entry.url} — {entry.state}{entry.reason ? ` (${entry.reason})` : ''}</li>)}</ul>
      {manifest.entries.length > 100 && <p>Showing the first 100 outcomes.</p>}
    </details>}
    {unavailable && <div role="status" className="rounded-lg border border-[var(--border)] p-4 space-y-2">
      <p>{isActive ? 'Crawl details have not been saved yet. Try again after this build finishes.' : 'This build has no saved per-URL crawl details. Older builds may predate crawl coverage tracking.'}</p>
      {!isActive && <><p>Rebuild knowledge to record crawl outcomes and enable scope review.</p><a className="underline" href="#knowledge-rebuild">Go to rebuild</a></>}
    </div>}
    {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
  </div>;
}
