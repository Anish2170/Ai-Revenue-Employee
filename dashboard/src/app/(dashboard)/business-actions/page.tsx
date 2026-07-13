'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';

type DestinationType = 'URL' | 'CHAT' | 'WHATSAPP' | 'PHONE' | 'EMAIL';

interface Website {
  id: string;
  name: string;
  url: string;
}

interface BusinessAction {
  id: string;
  actionId: string;
  label: string;
  destinationType: DestinationType;
  destination: string;
  enabled: boolean;
  isStarter: boolean;
  usageCount: number;
  ctr: number;
  lastUsed: string | null;
}

const DESTINATION_TYPES: DestinationType[] = ['URL', 'CHAT', 'WHATSAPP', 'PHONE', 'EMAIL'];
const EMPTY_CUSTOM = { actionId: '', label: '', destinationType: 'URL' as DestinationType, destination: '', enabled: true };

export default function BusinessActionsPage() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState('');
  const [actions, setActions] = useState<BusinessAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [custom, setCustom] = useState(EMPTY_CUSTOM);

  useEffect(() => {
    api.listWebsites()
      .then((data) => {
        const list = data as Website[];
        setWebsites(list);
        setWebsiteId(list[0]?.id ?? '');
      })
      .catch(() => setError('Unable to load websites.'))
      .finally(() => setLoading(false));
  }, []);

  const loadActions = useCallback(() => {
    if (!websiteId) return;
    setLoading(true);
    setError('');
    api.listBusinessActions(websiteId)
      .then((data) => setActions(((data as { actions: BusinessAction[] }).actions ?? [])))
      .catch(() => setError('Unable to load business actions.'))
      .finally(() => setLoading(false));
  }, [websiteId]);

  useEffect(() => {
    queueMicrotask(loadActions);
  }, [loadActions]);

  const selectedWebsite = useMemo(() => websites.find((site) => site.id === websiteId), [websites, websiteId]);

  async function saveAction(action: BusinessAction, patch: Partial<BusinessAction>) {
    if (!websiteId) return;
    setSaving(action.actionId);
    setError('');
    try {
      const updated = await api.updateBusinessAction(websiteId, action.actionId, {
        label: patch.label ?? action.label,
        destinationType: patch.destinationType ?? action.destinationType,
        destination: patch.destination ?? action.destination,
        enabled: patch.enabled ?? action.enabled,
      });
      setActions((prev) => prev.map((item) => item.actionId === action.actionId ? updated as BusinessAction : item));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save action.');
    } finally {
      setSaving(null);
    }
  }

  async function createAction() {
    if (!websiteId) return;
    setSaving('new');
    setError('');
    try {
      const created = await api.createBusinessAction(websiteId, custom);
      setActions((prev) => [...prev, created as BusinessAction]);
      setCustom(EMPTY_CUSTOM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create action.');
    } finally {
      setSaving(null);
    }
  }

  async function deleteAction(action: BusinessAction) {
    if (!websiteId) return;
    setSaving(action.actionId);
    setError('');
    try {
      await api.deleteBusinessAction(websiteId, action.actionId);
      if (action.isStarter) {
        setActions((prev) => prev.map((item) => item.actionId === action.actionId ? { ...item, enabled: false, destination: '' } : item));
      } else {
        setActions((prev) => prev.filter((item) => item.actionId !== action.actionId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete action.');
    } finally {
      setSaving(null);
    }
  }

  if (loading && websites.length === 0) return <div className="flex h-64 items-center justify-center"><Spinner /></div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Business Actions</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Configure the only destinations AI popups may use.</p>
        </div>
        <label className="flex min-w-64 flex-col gap-1.5 text-sm">
          <span className="font-medium">Website</span>
          <select className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2.5" value={websiteId} onChange={(e) => setWebsiteId(e.target.value)}>
            {websites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      {!selectedWebsite ? (
        <Card><EmptyState title="No websites yet" description="Create a website before configuring actions." /></Card>
      ) : (
        <>
          <Card>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Enabled Destinations</h2>
                <p className="text-sm text-[var(--text-muted)]">{selectedWebsite.url}</p>
              </div>
              {loading && <Spinner />}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-[var(--text-muted)]">
                  <tr className="border-b border-[var(--border)]">
                    <th className="py-3 pr-3">Action ID</th>
                    <th className="px-3 py-3">Display Label</th>
                    <th className="px-3 py-3">Enabled</th>
                    <th className="px-3 py-3">Destination Type</th>
                    <th className="px-3 py-3">Destination</th>
                    <th className="px-3 py-3 text-right">Usage</th>
                    <th className="px-3 py-3 text-right">CTR</th>
                    <th className="px-3 py-3">Last Used</th>
                    <th className="py-3 pl-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((action) => (
                    <ActionRow key={`${action.id}-${action.label}-${action.destinationType}-${action.destination}-${action.enabled}`} action={action} saving={saving === action.actionId} onSave={saveAction} onDelete={deleteAction} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold">Add Custom Action</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_150px_1.4fr_auto]">
              <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" placeholder="schedule_site_visit" value={custom.actionId} onChange={(e) => setCustom({ ...custom, actionId: e.target.value })} />
              <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" placeholder="Schedule Site Visit" value={custom.label} onChange={(e) => setCustom({ ...custom, label: e.target.value })} />
              <select className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" value={custom.destinationType} onChange={(e) => setCustom({ ...custom, destinationType: e.target.value as DestinationType })}>
                {DESTINATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
              <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" placeholder="https://company.com/site-visit" value={custom.destination} onChange={(e) => setCustom({ ...custom, destination: e.target.value })} />
              <Button onClick={createAction} loading={saving === 'new'} disabled={!custom.actionId || !custom.label}>Add</Button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ActionRow({ action, saving, onSave, onDelete }: { action: BusinessAction; saving: boolean; onSave: (action: BusinessAction, patch: Partial<BusinessAction>) => void; onDelete: (action: BusinessAction) => void }) {
  const [draft, setDraft] = useState(action);

  const changed = draft.label !== action.label || draft.destination !== action.destination || draft.destinationType !== action.destinationType || draft.enabled !== action.enabled;

  return (
    <tr className="border-b border-[var(--border)] align-top last:border-0">
      <td className="py-3 pr-3 font-mono text-xs">{action.actionId}</td>
      <td className="px-3 py-3"><input className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></td>
      <td className="px-3 py-3"><input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" /></td>
      <td className="px-3 py-3"><select className="rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5" value={draft.destinationType} onChange={(e) => setDraft({ ...draft, destinationType: e.target.value as DestinationType })}>{DESTINATION_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></td>
      <td className="px-3 py-3"><input className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2 py-1.5" value={draft.destination} onChange={(e) => setDraft({ ...draft, destination: e.target.value })} placeholder={draft.destinationType === 'CHAT' ? 'chat' : 'Configured destination'} /></td>
      <td className="px-3 py-3 text-right">{action.usageCount}</td>
      <td className="px-3 py-3 text-right">{formatPct(action.ctr)}</td>
      <td className="px-3 py-3 text-[var(--text-muted)]">{action.lastUsed ? new Date(action.lastUsed).toLocaleString() : '-'}</td>
      <td className="py-3 pl-3">
        <div className="flex justify-end gap-2">
          {action.isStarter && <Badge>Starter</Badge>}
          <Button size="sm" variant="secondary" loading={saving} disabled={!changed || saving} onClick={() => onSave(action, draft)}>Save</Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => onDelete(action)}>{action.isStarter ? 'Reset' : 'Delete'}</Button>
        </div>
      </td>
    </tr>
  );
}

function formatPct(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}
