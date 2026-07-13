'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Card, EmptyState, Input, Spinner } from '@/components/ui';

type Website = { id: string; name: string; url: string };
const SELECTED_WEBSITE_STORAGE_KEY = 'dashboard:selectedWebsiteId';
type Status = 'verified' | 'needs_review' | 'unknown';
type Method = 'rule' | 'llm' | 'hybrid';

type ActionRow = {
  id: string;
  intent: string;
  actionLabel: string;
  destinationUrl: string;
  automaticDestinationUrl: string;
  hasManualOverride: boolean;
  overrideUrl: string | null;
  foundOnPage: string;
  pageTitle: string;
  detectionMethod: Method;
  confidence: number;
  status: Status;
  occurrences: number;
  alternativeUrls: string[];
  pagesFound: string[];
  analytics: { popupUses: number; clicks: number; ctr: number; conversions: number };
  details: {
    detectedLabel: string;
    resolvedIntent: string;
    destinationUrl: string;
    pageUrl: string;
    pageTitle: string;
    whereFound: string[];
    domContext: string;
    surroundingHeading: string;
    detectionMethod: Method;
    rule: string | null;
    confidenceScore: number;
    occurrences: number;
    pagesFound: string[];
    alternativeUrls: string[];
    selectableUrls: string[];
    automaticDestinationUrl: string;
    hasManualOverride: boolean;
    overrideUrl: string | null;
    alternativeMatches: Array<{ label: string; url: string; confidence: number; page: string; method: Method; occurrences?: number }>;
    whySelected: string;
  };
};

type ActionsPayload = {
  notices?: string[];
  summary: { discoveredActions: number; recognizedIntents: number; highConfidence: number; needsReview: number; lastUpdated: string | null };
  timestamps: { lastCrawl: string | null; lastBuild: string | null; lastDiscovery: string | null; buildStatus: string | null; stageStatuses?: Array<{ stage: string; label: string; status: 'success' | 'failed' | 'running' | 'pending' | 'unknown'; error?: string }> };
  groups: Array<{ intent: string; preferredLabel: string; preferredUrl: string; count: number; averageConfidence: number; labels: string[] }>;
  actions: ActionRow[];
  websiteMap: Array<{ intent: string; label: string; url: string }>;
};

const SAVE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(label + ' timed out. Please try again.')), SAVE_TIMEOUT_MS);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timeout));
  });
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'verified', label: 'Ready' },
  { id: 'needs_review', label: 'Review Suggested' },
  { id: 'unknown', label: 'Unknown' },
  { id: 'rule', label: 'Rule Based' },
  { id: 'llm', label: 'LLM Classified' },
  { id: 'hybrid', label: 'Hybrid' },
] as const;

function intentLabel(intent: string) {
  return intent.replace(/_/g, ' ').toUpperCase();
}

function statusBadge(status: Status) {
  if (status === 'verified') return <Badge variant="success">Ready</Badge>;
  if (status === 'needs_review') return <Badge variant="warning">Review Suggested</Badge>;
  return <Badge variant="danger">Unknown</Badge>;
}


function statusDescription(status: Status) {
  if (status === 'verified') return 'The system is confident this action was detected correctly.';
  if (status === 'needs_review') return 'The system is reasonably confident but recommends a quick look.';
  return 'The system could not confidently determine this action.';
}

function reviewReason(action: ActionRow) {
  if (action.status === 'verified') return statusDescription(action.status);
  if (action.details.alternativeMatches.length > 1) return 'Multiple possible matches were found for this action.';
  if (action.details.alternativeMatches.length === 1) return 'A similar alternative was also found, so this is worth a quick review.';
  if (action.details.detectionMethod === 'llm') return `This CTA uses an uncommon label ('${action.details.detectedLabel}'). We mapped it to ${intentLabel(action.details.resolvedIntent)} because ${action.details.whySelected.toLowerCase()}.`;
  if (action.details.whereFound.length > 1) return 'This page contains several similar CTA locations.';
  return action.details.whySelected || statusDescription(action.status);
}
function methodLabel(method: Method) {
  if (method === 'llm') return 'LLM';
  if (method === 'hybrid') return 'Hybrid';
  return 'Rule';
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`;
}

function relativeTime(value: string | null) {
  if (!value) return 'Not available';
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return 'Not available';
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function stageIcon(status: string) {
  if (status === 'success') return 'OK';
  if (status === 'failed') return 'X';
  if (status === 'running') return '...';
  return '-';
}

function stageColor(status: string) {
  if (status === 'success') return 'var(--success)';
  if (status === 'failed') return 'var(--danger)';
  if (status === 'running') return 'var(--warning)';
  return 'var(--text-muted)';
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="rounded-lg p-4">
      <div className="text-xs font-medium uppercase" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="mt-2 text-2xl font-semibold" style={{ color: 'var(--text)' }}>{value}</div>
      {hint && <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</div>}
    </Card>
  );
}

export default function WebsiteActionsPage() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState('');
  const [payload, setPayload] = useState<ActionsPayload | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingOverride, setSavingOverride] = useState(false);
  const [overrideModal, setOverrideModal] = useState<ActionRow | null>(null);
  const [selectedOverrideUrl, setSelectedOverrideUrl] = useState('');
  const [modalError, setModalError] = useState('');

  useEffect(() => {
    api.listWebsites().then((data) => {
      const sites = data as Website[];
      setWebsites(sites);
      const storedWebsiteId = window.localStorage.getItem(SELECTED_WEBSITE_STORAGE_KEY);
      const selected = sites.find((site) => site.id === storedWebsiteId) ?? sites[0];
      if (selected) setWebsiteId(selected.id);
    });
  }, []);

  const loadActions = useCallback(() => {
    setLoading(true);
    setError('');
    api.getDiscoveredWebsiteActions(websiteId)
      .then((data) => setPayload(data as ActionsPayload))
      .catch((err) => {
        setPayload(null);
        setError(err instanceof Error ? err.message : 'Failed to load Website Actions.');
      })
      .finally(() => setLoading(false));
  }, [websiteId]);

  useEffect(() => {
    if (!websiteId) return;
    void Promise.resolve().then(loadActions);
  }, [websiteId, loadActions]);

  
  function openOverrideModal(action: ActionRow) {
    setOverrideModal(action);
    setSelectedOverrideUrl(action.destinationUrl);
    setModalError('');
  }

  async function saveOverride() {
    if (!websiteId || !overrideModal || !selectedOverrideUrl) return;
    setSavingOverride(true);
    setModalError('');
    try {
      setError('');
      await withTimeout(api.updateDiscoveredActionUrlOverride(websiteId, overrideModal.intent, selectedOverrideUrl), 'Saving preferred URL override');
      const data = await withTimeout(api.getDiscoveredWebsiteActions(websiteId), 'Refreshing Website Actions');
      setPayload(data as ActionsPayload);
      setOverrideModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to save preferred URL override.');
    } finally {
      setSavingOverride(false);
    }
  }

  async function clearOverride() {
    if (!websiteId || !overrideModal) return;
    setSavingOverride(true);
    setModalError('');
    try {
      setError('');
      await withTimeout(api.clearDiscoveredActionUrlOverride(websiteId, overrideModal.intent), 'Clearing preferred URL override');
      const data = await withTimeout(api.getDiscoveredWebsiteActions(websiteId), 'Refreshing Website Actions');
      setPayload(data as ActionsPayload);
      setOverrideModal(null);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Failed to clear preferred URL override.');
    } finally {
      setSavingOverride(false);
    }
  }

  const filteredActions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (payload?.actions ?? []).filter((action) => {
      const matchesFilter = filter === 'all' || action.status === filter || action.detectionMethod === filter;
      const haystack = [action.intent, action.actionLabel, action.destinationUrl, action.foundOnPage, action.pageTitle].join(' ').toLowerCase();
      return matchesFilter && (!needle || haystack.includes(needle));
    });
  }, [payload, query, filter]);

  const grouped = useMemo(() => {
    const map = new Map<string, ActionRow[]>();
    for (const action of filteredActions) {
      const list = map.get(action.intent) ?? [];
      list.push(action);
      map.set(action.intent, list);
    }
    return Array.from(map.entries());
  }, [filteredActions]);

  const selectedWebsite = websites.find((site) => site.id === websiteId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Website Actions</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Automatically discovered business actions from your latest Knowledge Build.</p>
        </div>
        <label className="flex min-w-80 flex-col gap-1 text-sm" style={{ color: 'var(--text)' }}>
          Website
          <select className="rounded-lg border px-3 py-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }} value={websiteId} onChange={(e) => { window.localStorage.setItem(SELECTED_WEBSITE_STORAGE_KEY, e.target.value); setWebsiteId(e.target.value); }}>
            {websites.map((site) => <option key={site.id} value={site.id}>{site.name} - {site.url}</option>)}
          </select>
        </label>
      </div>

      {loading && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}><Spinner className="h-4 w-4" /> Loading website actions</div>}
      {error && <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--danger)', color: 'var(--text)', background: 'rgba(239, 68, 68, 0.12)' }}>{error}</div>}

      {(payload?.notices ?? []).map((notice) => (
        <div key={notice} className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--warning)', color: 'var(--text)', background: 'rgba(245, 158, 11, 0.12)' }}>{notice}</div>
      ))}

      <div className="grid gap-3 md:grid-cols-5">
        <StatCard label="Business Actions" value={payload?.summary.discoveredActions ?? 0} />
        <StatCard label="Recognized Intents" value={payload?.summary.recognizedIntents ?? 0} />
        <StatCard label="Ready" value={payload?.summary.highConfidence ?? 0} />
        <StatCard label="Review Suggested" value={payload?.summary.needsReview ?? 0} />
        <StatCard label="Last Updated" value={relativeTime(payload?.summary.lastUpdated ?? null)} />
      </div>

      {payload?.actions.length === 0 && !loading ? (
        <Card>
          <EmptyState
            title="No business actions have been discovered yet."
            description="Run a Knowledge Build to analyze your website."
          />
        </Card>
      ) : (
        <>
          <Card className="rounded-lg p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Last Crawl</div><div className="text-sm" style={{ color: 'var(--text)' }}>{relativeTime(payload?.timestamps.lastCrawl ?? null)}</div></div>
              <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Last Build</div><div className="text-sm" style={{ color: 'var(--text)' }}>{relativeTime(payload?.timestamps.lastBuild ?? null)}{payload?.timestamps.buildStatus ? ` (${payload.timestamps.buildStatus})` : ''}</div></div>
              <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Last Discovery</div><div className="text-sm" style={{ color: 'var(--text)' }}>{relativeTime(payload?.timestamps.lastDiscovery ?? null)}</div></div>
            </div>
            {payload?.timestamps.stageStatuses?.length ? (
              <div className="mt-4 grid gap-2 md:grid-cols-5">
                {payload.timestamps.stageStatuses.map((stage) => (
                  <div key={stage.stage} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} title={stage.error ?? undefined}>
                    <span className="mr-2 font-semibold" style={{ color: stageColor(stage.status) }}>{stageIcon(stage.status)}</span>{stage.label}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>

          <Card className="rounded-lg p-4">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Visual Website Map</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>{selectedWebsite?.name ?? 'Homepage'}</div>
              {(payload?.websiteMap ?? []).map((item) => (
                <div key={`${item.intent}-${item.url}`} className="flex items-center gap-2">
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <div className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text)' }}>
                    <div>{item.label}</div>
                    <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{item.intent}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="rounded-lg p-4">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Intent Groups</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(payload?.groups ?? []).map((group) => (
                <div key={group.intent} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>{intentLabel(group.intent)}</div>
                  <div className="mt-2 space-y-1 text-sm" style={{ color: 'var(--text)' }}>
                    {group.labels.slice(0, 5).map((label) => <div key={label}>{label}</div>)}
                  </div>
                  <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{group.count} detected actions</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="rounded-lg p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Input label="Search actions" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search intent, label, URL, or page" className="min-w-80" />
              <div className="flex flex-wrap gap-2">
                {FILTERS.map((item) => (
                  <button key={item.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: filter === item.id ? 'var(--accent)' : 'var(--border)', background: filter === item.id ? 'rgba(24, 69, 59, 0.10)' : 'transparent', color: 'var(--text)' }} onClick={() => setFilter(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-5 space-y-5">
              {grouped.map(([intent, actions]) => (
                <div key={intent}>
                  <div className="mb-2 text-xs font-semibold tracking-wide" style={{ color: 'var(--accent-hover)' }}>{intentLabel(intent)}</div>
                  <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                    <table className="w-full text-left text-sm" style={{ color: 'var(--text)' }}>
                      <thead style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                        <tr>{['Business Action','Intent','Preferred URL','Occurrences','Pages Found','Status','Review Note','Popup Uses','Clicks','CTR','Conversions'].map((h) => <th key={h} className="p-3 font-medium">{h}</th>)}</tr>
                      </thead>
                      <tbody>
                        {actions.map((action) => (
                          <Fragment key={action.id}>
                            <tr key={action.id} className="cursor-pointer align-top" onClick={() => setExpanded(expanded === action.id ? null : action.id)}>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{action.actionLabel}</td>
                              <td className="border-t p-3 font-mono text-xs" style={{ borderColor: 'var(--border)' }}>{action.intent}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
                                <div className="flex items-center gap-2">
                                  <span className="break-all">{action.destinationUrl}</span>
                                  <button type="button" className="rounded border px-2 py-1 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={(event) => { event.stopPropagation(); openOverrideModal(action); }} title="Edit preferred URL">Edit</button>
                                </div>
                                {action.hasManualOverride && <div className="mt-1 text-xs font-medium" style={{ color: 'var(--accent-hover)' }} title="This destination was manually selected by your team.">Manual Override</div>}
                              </td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{action.occurrences}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{action.pagesFound.length}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{statusBadge(action.status)}</td>
                              <td className="border-t p-3 max-w-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>{action.status === 'verified' ? statusDescription(action.status) : reviewReason(action)}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{action.analytics.popupUses}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{action.analytics.clicks}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{pct(action.analytics.ctr)}</td>
                              <td className="border-t p-3" style={{ borderColor: 'var(--border)' }}>{action.analytics.conversions}</td>
                            </tr>
                            {expanded === action.id && (
                              <tr>
                                <td colSpan={11} className="border-t p-4" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                                  <div className="mb-4 rounded-lg border p-3 text-sm" style={{ borderColor: action.status === 'verified' ? 'var(--success)' : action.status === 'needs_review' ? 'var(--warning)' : 'var(--danger)', color: 'var(--text)' }}>
                                    {statusBadge(action.status)}
                                    <div className="mt-2 font-medium">Why this intent was selected</div>
                                    <div className="mt-1" style={{ color: 'var(--text-muted)' }}>{reviewReason(action)}</div>
                                  </div>
                                  <div className="grid gap-4 md:grid-cols-3">
                                    <Detail title="Detected Label" value={action.details.detectedLabel} />
                                    <Detail title="Resolved Intent" value={action.details.resolvedIntent} mono />
                                    <Detail title="Preferred URL" value={action.details.destinationUrl} />
                                    {action.hasManualOverride && <Detail title="Automatically Detected URL" value={action.details.automaticDestinationUrl} />}
                                    <Detail title="Occurrences" value={String(action.details.occurrences)} />
                                    <Detail title="Pages Found" value={action.details.pagesFound.join(', ') || action.details.pageUrl} />
                                    <Detail title="Page Title" value={action.details.pageTitle || 'Untitled'} />
                                    <Detail title="Where Found" value={action.details.whereFound.join(', ') || 'Anchor'} />
                                    <Detail title="DOM Context" value={action.details.domContext || 'Not captured'} />
                                    <Detail title="Surrounding Heading" value={action.details.surroundingHeading || 'None'} />
                                    <Detail title="Detection Method" value={methodLabel(action.details.detectionMethod)} />
                                    <Detail title="Rule" value={action.details.rule ?? 'None'} />
                                    <Detail title="Developer Confidence" value={pct(action.details.confidenceScore)} />
                                    <Detail title="Reason Selected" value={action.details.whySelected} />
                                  </div>
                                  <div className="mt-4">
                                    <div className="mb-2 text-sm font-medium" style={{ color: 'var(--text)' }}>Alternative URLs</div>
                                    {action.details.alternativeMatches.length ? (
                                      <div className="grid gap-2 md:grid-cols-2">
                                        {action.details.alternativeMatches.slice(0, 6).map((alt) => (
                                          <div key={`${alt.label}-${alt.url}`} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                                            <div>{alt.label} <span style={{ color: 'var(--text-muted)' }}>({alt.occurrences ?? 1} occurrence{(alt.occurrences ?? 1) === 1 ? '' : 's'})</span></div>
                                            <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{alt.url}</div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No alternatives for this intent.</div>}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      {overrideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOverrideModal(null)}>
          <div className="w-full max-w-lg rounded-lg border p-5 shadow-xl" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)', color: 'var(--text)' }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">Edit Preferred URL</h2>
              <button type="button" className="rounded border px-2 py-1 text-sm" style={{ borderColor: 'var(--border)' }} onClick={() => setOverrideModal(null)}>Close</button>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <Detail title="Intent" value={overrideModal.intent} mono />
              <Detail title="Detected Business Action" value={overrideModal.actionLabel} />
              <Detail title="Current Preferred URL" value={overrideModal.destinationUrl} />
              <div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Alternative Discovered URLs</div>
                <div className="mt-2 space-y-2">
                  {overrideModal.details.selectableUrls.map((url) => (
                    <label key={url} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: selectedOverrideUrl === url ? 'var(--accent)' : 'var(--border)', background: selectedOverrideUrl === url ? 'rgba(24, 69, 59, 0.10)' : 'transparent' }}>
                      <input type="radio" name="preferredUrlOverride" value={url} checked={selectedOverrideUrl === url} onChange={() => setSelectedOverrideUrl(url)} />
                      <span className="break-all font-mono text-xs">{url}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            {modalError && <div className="mt-4 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--danger)', color: 'var(--text)', background: 'rgba(239, 68, 68, 0.12)' }}>{modalError}</div>}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {overrideModal.hasManualOverride && <button type="button" className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={clearOverride} disabled={savingOverride}>Use Automatic</button>}
              <button type="button" className="rounded-lg px-4 py-2 text-sm font-medium" style={{ background: 'var(--accent)', color: 'white' }} onClick={saveOverride} disabled={savingOverride || !selectedOverrideUrl}>{savingOverride ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Detail({ title, value, mono = false }: { title: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{title}</div>
      <div className={`mt-1 break-words text-sm ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  );
}








