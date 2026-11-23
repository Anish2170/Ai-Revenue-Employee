'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorMessage, popupReplayApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button, Card, Input } from '@/components/ui';
import { PageHeader } from '@/components/operations';
import { replaySummary, scenarioLabels, type ReplayBatch, type ReplayInventory, type ReplayRun } from '@/lib/popup-replay';

type Site = { id: string; name: string; url: string };
const money = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`;
const selectClass = 'min-h-11 w-full rounded-lg border border-[var(--landing-soft-border)] bg-white px-3 py-2 text-sm';

function RunCard({ run, onRate }: { run: ReplayRun; onRate: (id: string, rating: string) => Promise<void> }) {
  const [image, setImage] = useState(''), [open, setOpen] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    if (!open || !run.result?.hasScreenshot) return;
    let alive = true, url = '';
    popupReplayApi.screenshot(run.id).then(blob => { if (alive) { url = URL.createObjectURL(blob); setImage(url); } }).catch(cause => alive && setError(errorMessage(cause)));
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [open, run.id, run.result?.hasScreenshot]);
  const recentTrace = [...run.trace].reverse();
  const decision = recentTrace.find(item => item.kind === 'decision' && item.popup) ?? recentTrace.find(item => item.kind === 'decision') ?? recentTrace.find(item => item.kind === 'signals' && typeof item.confidence === 'number');
  const popup = run.result?.popup;
  return <Card className="flex flex-col gap-3 !p-4">
    <div className="flex items-start justify-between gap-2"><strong>Run {run.ordinal}</strong><span className={`rounded px-2 py-1 text-xs ${run.status === 'DISPLAYED' ? 'bg-emerald-50 text-emerald-800' : ['FAILED', 'UNEXPECTED_POPUP'].includes(run.status) ? 'bg-red-50 text-red-800' : 'bg-gray-100 text-gray-700'}`}>{run.status.replaceAll('_', ' ')}</span></div>
    <p className="text-sm text-gray-600">{scenarioLabels[run.scenario] ?? run.scenario}</p>
    {popup ? <div className="rounded-xl border bg-[#f8faf9] p-4"><p className="mb-2 text-xs font-semibold uppercase text-emerald-800">{popup.type}</p><h3 className="font-semibold">{popup.title}</h3><p className="mt-2 text-sm text-gray-700">{popup.body}</p>{popup.cta && <span className="mt-3 inline-block rounded-lg bg-[#18453b] px-3 py-2 text-xs font-semibold text-white">{popup.cta}</span>}</div> : <p className="text-sm">{run.result?.reason ?? (run.status === 'QUEUED' ? 'Waiting for the local runner.' : 'Decision details will appear here.')}</p>}
    <p className="text-xs text-gray-600">Confidence: {typeof decision?.confidence === 'number' ? `${Math.round(decision.confidence * 100)}%` : '—'} · External calls: {run.externalCalls}</p>
    {decision?.reason && <p className="text-xs">Reason: {String(decision.reason).replaceAll('_', ' ')}</p>}
    {popup && <div className="flex flex-wrap gap-2" aria-label={`Rate run ${run.ordinal}`}>{[['HELPFUL', 'Helpful'], ['GENERIC', 'Generic'], ['WRONG_CONTEXT', 'Wrong context']].map(([value, label]) => <Button key={value} size="sm" variant={run.rating === value ? 'primary' : 'secondary'} onClick={() => void onRate(run.id, value)}>{label}</Button>)}</div>}
    <Button variant="ghost" size="sm" onClick={() => setOpen(value => !value)}>{open ? 'Hide details' : 'Screenshot and decision details'}</Button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {open && <div className="space-y-3 text-xs">
      {image && <img src={image} alt={`Actual browser screenshot from run ${run.ordinal}`} className="max-h-96 w-full rounded border object-contain" />}
      <p>Visitor: {run.visitorId ?? 'Not issued'}<br />Session: {run.sessionId ?? 'Not issued'}</p>
      {popup?.destination && <p className="break-all">Configured destination: {popup.destination}</p>}
      <p>{run.result?.serverDisplayConfirmed ? 'Browser display confirmed by the backend receipt.' : 'No backend display receipt confirmed.'}</p>
      <ol className="list-inside list-decimal space-y-1">{run.result?.steps?.map((step, index) => <li key={index}>{(step.atMs / 1000).toFixed(1)}s · {step.action} {step.path}</li>)}</ol>
      <details><summary className="cursor-pointer font-semibold">Decision and usage trace</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2">{JSON.stringify(run.trace, null, 2)}</pre></details>
    </div>}
  </Card>;
}

export default function PopupTestLab() {
  const { role } = useAuth(); const allowed = role === 'OWNER' || role === 'ADMIN';
  const [inventory, setInventory] = useState<ReplayInventory>({ runners: [], batches: [], scenarios: Object.keys(scenarioLabels) });
  const [sites, setSites] = useState<Site[]>([]), [siteId, setSiteId] = useState(''), [runnerId, setRunnerId] = useState('');
  const [selectedId, setSelectedId] = useState(''), [batch, setBatch] = useState<ReplayBatch | null>(null);
  const [scenarios, setScenarios] = useState(['pricing', 'research', 'comparison', 'trust', 'form_pause']);
  const [count, setCount] = useState(5), [budget, setBudget] = useState('1.00'), [surface, setSurface] = useState('desktop');
  const [pairCode, setPairCode] = useState(''), [pairExpiry, setPairExpiry] = useState(''), [busy, setBusy] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const data = await popupReplayApi.inventory(); setInventory(data);
    setRunnerId(current => data.runners.some(r => r.id === current && !r.revoked) ? current : data.runners.find(r => r.online)?.id ?? '');
    setSelectedId(current => current || data.batches[0]?.id || '');
  }, []);
  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    api.listWebsites().then(data => { if (!alive) return; const list = data as Site[]; setSites(list); setSiteId(list[0]?.id ?? ''); }).catch(cause => alive && setError(errorMessage(cause)));
    void refresh().catch(cause => alive && setError(errorMessage(cause))).finally(() => alive && setLoading(false));
    const timer = setInterval(() => { void refresh().catch(cause => alive && setError(errorMessage(cause))); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [allowed, refresh]);
  useEffect(() => {
    if (!allowed || !selectedId) return;
    let alive = true;
    const load = () => popupReplayApi.batch(selectedId).then(data => { if (alive) setBatch(data); }).catch(cause => alive && setError(errorMessage(cause)));
    void load(); const timer = setInterval(() => { void load(); }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [allowed, selectedId]);
  const act = async (name: string, fn: () => Promise<unknown>) => { setBusy(name); setError(''); try { await fn(); await refresh(); if (selectedId) setBatch(await popupReplayApi.batch(selectedId)); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(''); } };
  const summary = useMemo(() => replaySummary(batch?.runs ?? []), [batch]);
  const online = inventory.runners.find(r => r.id === runnerId)?.online;
  const active = inventory.batches.some(b => b.runnerId === runnerId && ['QUEUED', 'RUNNING', 'PAUSED'].includes(b.status));
  const validBudget = Number(budget) >= .01 && Number(budget) <= 1;
  if (role && !allowed) return <Card><h1>Popup Test Lab</h1><p className="mt-2">An owner or administrator can run browser replays.</p></Card>;
  return <div className="space-y-6">
    <PageHeader title="Popup Test Lab" description="Replay real browsing journeys with fresh visitors. Review what appeared, why it appeared, and when the widget stayed silent." />
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<Button size="sm" variant="ghost" onClick={() => void act('refresh', refresh)}>Retry</Button></div>}
    <Card><h2 className="text-lg font-semibold">1. Connect your laptop</h2><p className="mt-2 text-sm text-gray-600">Browsers run on your laptop. A connection lasts up to 24 hours; the pairing code works once and expires in 10 minutes.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button loading={busy === 'pair'} disabled={!!busy} onClick={() => void act('pair', async () => { const paired = await popupReplayApi.pair('My laptop'); setPairCode(paired.pairingCode); setPairExpiry(paired.pairingExpiresAt); })}>Create pairing code</Button><span className="text-sm">{inventory.runners.some(r => r.online) ? 'Runner connected' : 'No runner connected'}</span></div>
      {pairCode && <div className="mt-4 rounded-lg bg-gray-50 p-3"><label className="text-xs font-semibold" htmlFor="pair-code">One-time pairing code</label><input id="pair-code" readOnly value={pairCode} className={`${selectClass} mt-2 font-mono text-xs`} /><p className="mt-2 text-xs">Expires {new Date(pairExpiry).toLocaleTimeString()}. Paste it into the runner prompt; keep it private.</p><Button size="sm" variant="ghost" onClick={() => setPairCode('')}>Hide code</Button></div>}
      <details className="mt-4 text-sm"><summary className="cursor-pointer font-semibold">Start the included local runner</summary><pre className="mt-3 overflow-auto rounded-lg bg-gray-50 p-3 text-xs">{`cd popup-replay-runner\nnpm ci\nnpx playwright install chromium\nnpm start -- --backend ${popupReplayApi.backendUrl()} --headed`}</pre><p className="mt-2 text-gray-600">Paste the pairing code when prompted. Keep the runner open while a batch runs. Ctrl+C stops its browser.</p></details>
      <ul className="mt-4 space-y-2">{inventory.runners.filter(r => !r.revoked).map(r => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{r.name} · {r.online ? 'Online' : 'Offline'}</span><Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act('revoke', () => popupReplayApi.revoke(r.id))}>Disconnect and revoke</Button></li>)}</ul>
    </Card>
    <Card><h2 className="text-lg font-semibold">2. Choose the journeys</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-2 text-sm">Website<select aria-label="Replay website" className={selectClass} value={siteId} onChange={e => setSiteId(e.target.value)}>{sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="space-y-2 text-sm">Runner<select aria-label="Replay runner" className={selectClass} value={runnerId} onChange={e => setRunnerId(e.target.value)}><option value="">Select a runner</option>{inventory.runners.filter(r => !r.revoked).map(r => <option key={r.id} value={r.id}>{r.name} · {r.online ? 'Online' : 'Offline'}</option>)}</select></label>
        <Input id="run-count" label="Journeys (1–50)" type="number" min={1} max={50} value={count} onChange={e => setCount(Number(e.target.value))} />
        <label className="space-y-2 text-sm">Browser view<select aria-label="Replay device" className={selectClass} value={surface} onChange={e => setSurface(e.target.value)}><option value="desktop">Desktop Chrome</option><option value="mobile">Mobile emulation</option></select></label>
      </div>
      <fieldset className="mt-5 grid gap-3 sm:grid-cols-2"><legend className="mb-3 text-sm font-semibold">Browsing journeys</legend>{Object.entries(scenarioLabels).map(([value, label]) => <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={scenarios.includes(value)} onChange={e => setScenarios(current => e.target.checked ? [...current, value] : current.filter(item => item !== value))} />{label}</label>)}</fieldset>
      <div className="mt-5 max-w-xs"><Input id="replay-budget" label="Batch allowance (USD, max $1)" type="number" step="0.01" min="0.01" max="1" value={budget} onChange={e => setBudget(e.target.value)} /></div>
      <p className="mt-3 text-sm text-gray-600">Each journey starts with a new visitor. The first five are the pilot. Errors, unexpected popups, or no positive pilot displays pause the batch for review. Fifty journeys do not guarantee fifty popups.</p>
      <p className="mt-2 text-xs text-gray-600">External generation and query embeddings use your API account. Allowance is conservatively reserved before each attempt, including timeouts and fallbacks; it is not the final provider invoice. Test traffic is separate from customer analytics.</p>
      <Button className="mt-4" loading={busy === 'start'} disabled={!!busy || loading || !online || active || !siteId || !scenarios.length || !Number.isInteger(count) || count < 1 || count > 50 || !validBudget} onClick={() => void act('start', async () => { const created = await popupReplayApi.create({ websiteId: siteId, runnerId, count, scenarios, surface, budgetMicros: Math.round(Number(budget) * 1_000_000) }); setSelectedId(created.id); setBatch(await popupReplayApi.batch(created.id)); })}>Start browser replay</Button>
      {!online && <p className="mt-2 text-sm text-gray-600">Connect a runner to enable Start.</p>}{active && <p className="mt-2 text-sm text-gray-600">Finish, resume or stop the current batch before starting another.</p>}
    </Card>
    <Card><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">3. Review the results</h2><select aria-label="Result batch" className={`${selectClass} !w-auto max-w-full`} value={selectedId} onChange={e => setSelectedId(e.target.value)}><option value="">Choose a batch</option>{inventory.batches.map(b => <option key={b.id} value={b.id}>{new Date(b.createdAt).toLocaleString()} · {b.status}</option>)}</select></div>
      {!batch ? <p className="mt-4 text-sm text-gray-600">Start a batch to collect actual browser screenshots and decisions.</p> : <>
        <div className="mt-4 flex flex-wrap items-center gap-3"><strong>{batch.status.replaceAll('_', ' ')}</strong><span className="text-sm">Reserved {money(batch.reservedMicros)} / {money(batch.budgetMicros)} · {batch.externalCalls} external calls</span>
          {['RUNNING', 'QUEUED', 'PAUSED'].includes(batch.status) && <Button size="sm" variant="danger" disabled={!!busy} onClick={() => void act('stop', () => popupReplayApi.control(batch.id, 'stop'))}>Stop batch</Button>}
          {batch.status === 'PAUSED' && <Button size="sm" disabled={!!busy || !inventory.runners.find(r => r.id === batch.runnerId)?.online} onClick={() => void act('resume', () => popupReplayApi.control(batch.id, 'resume'))}>Continue remaining journeys</Button>}
          <Button size="sm" variant="secondary" onClick={() => { const blob = new Blob([JSON.stringify(batch, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `popup-replay-${batch.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download report</Button>
        </div>
        <p className="mt-3 text-sm">{summary.displayed} displayed · {summary.suppressed} silent · {summary.failed} failed/unexpected · {summary.repeatedCopies} repeated bodies</p>
        <p className="mt-2 text-sm text-gray-600">{Object.entries(summary.types).map(([type, n]) => `${type}: ${n}`).join(' · ') || 'Popup type distribution appears after successful displays.'}</p>
        <p className="mt-2 text-xs text-gray-500">This is a controlled test distribution, not real-visitor traffic. Screenshots are retained for up to seven days. Paused batches retain the remaining queued journeys.</p>
      </>}
    </Card>
    {batch?.runs && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{batch.runs.map(run => <RunCard key={run.id} run={run} onRate={async (id, rating) => { await act('rating', () => popupReplayApi.rate(id, rating)); }} />)}</div>}
  </div>;
}
