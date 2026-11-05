'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { KnowledgeInventory, KnowledgeSourceDetail, KnowledgeSourceItem, KnowledgePreview } from '@/lib/knowledge-sources';
import { Badge, Button, Card, Input, Spinner } from '@/components/ui';

const field = 'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm';
const date = (value: string | null) => value ? new Date(value).toLocaleString() : 'Not recorded';

export function KnowledgeSources({ websiteId, version }: { websiteId: string; version?: string }) {
  const [inventory, setInventory] = useState<KnowledgeInventory | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [selected, setSelected] = useState<KnowledgeSourceDetail | null>(null);
  const [draft, setDraft] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [preview, setPreview] = useState<KnowledgePreview | null>(null);
  const [deleting, setDeleting] = useState<KnowledgeSourceItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (selected) reviewHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [selected]);
  const refresh = useCallback(async () => { setInventory(await api.getKnowledgeSources(websiteId)); }, [websiteId]);
  useEffect(() => {
    let alive = true;
    let timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await api.getKnowledgeSources(websiteId); if (alive) setInventory(result); }
      catch (err) { if (alive) setError(err instanceof Error ? err.message : 'Unable to load sources.'); }
      if (alive) timeout = setTimeout(() => { void poll(); }, 5000);
    };
    void poll();
    return () => { alive = false; clearTimeout(timeout); };
  }, [websiteId, version]);
  const action = async (key: string, work: () => Promise<unknown>, message = 'Saved.') => {
    setBusy(key); setError(''); setNotice('');
    try { await work(); await refresh(); setNotice(message); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to complete this action.'); }
    finally { setBusy(''); }
  };
  const sourceId = async (item: KnowledgeSourceItem) => item.id ?? (await api.addKnowledgePage(websiteId, item.url!, false)).id;
  const review = (item: KnowledgeSourceItem) => action('review', async () => {
    const detail = await api.getKnowledgeSource(websiteId, await sourceId(item));
    setSelected(detail); setDraft(detail.pendingContent ?? detail.content); setDraftTitle(detail.title);
  }, 'Source opened.');
  const upload = () => action('upload', async () => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) throw new Error('Choose a file up to 5 MB.');
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Unable to read this file.'));
      reader.readAsDataURL(file);
    });
    await api.uploadKnowledgeFile(websiteId, file.name, data);
    setFile(null); if (fileInput.current) fileInput.current.value = '';
  }, 'File queued. It becomes available to the AI after processing succeeds.');
  const items = inventory?.items.filter(item => (statusFilter === 'ALL' || (statusFilter === 'DISABLED' ? !item.enabled : item.status === statusFilter))
    && `${item.title} ${item.url ?? ''} ${item.summary}`.toLowerCase().includes(filter.toLowerCase())) ?? [];
  const conflictLabel = (sourceUrl: string) => inventory?.items.find(item => item.url === sourceUrl || item.id === sourceUrl.split('/__knowledge/source/')[1])?.title ?? sourceUrl;

  return <div className="space-y-6">
    {(notice || error) && <div role={error ? 'alert' : 'status'} className={`sticky top-4 z-20 rounded-lg border bg-white p-3 text-sm shadow-sm ${error ? 'border-[var(--danger)] text-[var(--danger)]' : 'border-[var(--border)] text-[var(--text)]'}`}>{error || notice}</div>}
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-lg font-semibold">Your knowledge sources</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Review what the AI can use, fill missing information, and keep individual sources current.</p></div>
        <Button variant="secondary" disabled={Boolean(busy)} onClick={() => void action('reload', refresh, 'Sources refreshed.')}>Refresh list</Button>
      </div>
      {inventory ? <>
        <div className="my-5 grid grid-cols-3 gap-3">
          {[['Sources', inventory.overview.total], ['Ready & enabled', inventory.overview.ready], ['Searchable sections', inventory.overview.chunks]].map(([label, value]) => <div key={label} className="rounded-lg border border-[var(--border)] p-3"><p className="text-2xl font-semibold">{value}</p><p className="text-xs text-[var(--text-muted)]">{label}</p></div>)}
        </div>
        <p className="text-xs text-[var(--text-muted)]">Topics from indexed sources. Open a source to check its complete extracted content; an overview does not guarantee completeness.</p>
        <div className="my-3 flex flex-wrap gap-2">{inventory.overview.topics.map(topic => <Badge key={topic}>{topic}</Badge>)}</div>
      </> : !error && <div className="my-5"><Spinner /></div>}
      <div className="my-4 flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1"><Input id={`source-filter-${websiteId}`} label="Find a source" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Search title, URL or summary" /></div>
        <label className="text-sm">Status<select aria-label="Filter source status" className={`${field} mt-1`} value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>{['ALL', 'READY', 'QUEUED', 'RUNNING', 'PARTIAL', 'FAILED', 'SKIPPED', 'DISABLED', 'REMOVED'].map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      <div className="max-h-[640px] space-y-3 overflow-y-auto">
        {items.map((item, index) => <div key={item.id ?? item.url ?? index} className="rounded-lg border border-[var(--border)] p-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div className="min-w-0 flex-1"><h3 className="break-words font-medium">{item.title}</h3>{item.url && <a className="break-all text-xs text-[var(--accent)]" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>}</div>
            <div className="flex items-start gap-2"><Badge variant={item.status === 'FAILED' ? 'danger' : item.status === 'READY' ? 'success' : 'warning'}>{item.status}</Badge><Badge>{item.kind}</Badge>{!item.enabled && <Badge>Disabled</Badge>}</div>
          </div>
          {item.summary && <p className="mt-2 text-sm text-[var(--text-muted)]">{item.summary}{item.characters > 320 ? '…' : ''}</p>}
          {item.reason && <p className="mt-2 text-xs text-[var(--warning)]">{item.reason}</p>}
          {item.servingPrevious && <p className="mt-2 text-xs">AI is using this source’s previous published content while this update is pending or failed.</p>}
          <p className="my-2 text-xs text-[var(--text-muted)]">{item.chunkCount} sections · {item.characters.toLocaleString()} characters · Published: {date(item.publishedAt)} · Checked: {date(item.checkedAt)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void review(item)}>Review content</Button>
            {item.status === 'REMOVED' ? <Button size="sm" variant="secondary" disabled={Boolean(busy)} onClick={() => void action('restore', async () => api.updateKnowledgeSource(websiteId, await sourceId(item), { restore: true }))}>Restore</Button> : <>
              <Button size="sm" variant="secondary" disabled={Boolean(busy) || ['QUEUED', 'RUNNING'].includes(item.status)} onClick={() => void action('retry', async () => api.refreshKnowledgeSource(websiteId, await sourceId(item)), 'Only this source is queued for refresh.')}>{item.status === 'FAILED' ? 'Retry' : 'Refresh source'}</Button>
              <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => void action('toggle', async () => api.updateKnowledgeSource(websiteId, await sourceId(item), { enabled: !item.enabled }), item.enabled ? 'Source excluded from AI answers.' : 'Source enabled.')}>{item.enabled ? 'Disable' : 'Enable'}</Button>
              <label className="ml-2 flex items-center gap-2 text-xs">Source priority<select aria-label={`Priority for ${item.title}`} className="rounded border border-[var(--border)] p-1" disabled={Boolean(busy)} value={item.priority} onChange={event => { const priority = Number(event.target.value); void action('priority', async () => api.updateKnowledgeSource(websiteId, await sourceId(item), { priority })); }}><option value={0}>Normal</option><option value={50}>Preferred</option><option value={100}>Highest</option></select></label>
              <Button size="sm" variant="ghost" disabled={Boolean(busy)} onClick={() => setDeleting(item)}>Remove</Button>
            </>}
          </div>
        </div>)}
        {inventory && !items.length && <p className="py-6 text-sm text-[var(--text-muted)]">{inventory.items.length ? 'No sources match these filters.' : 'Add a page, upload a file or write a note to start.'}</p>}
      </div>
      {deleting && <div role="alert" className="mt-4 rounded-lg border border-[var(--warning)] p-4"><p>Remove “{deleting.title}” from AI answers? You can restore it from the Removed filter.</p><div className="mt-3 flex gap-2"><Button variant="danger" disabled={Boolean(busy)} onClick={() => void action('delete', async () => { await api.deleteKnowledgeSource(websiteId, await sourceId(deleting)); setDeleting(null); setSelected(null); }, 'Source removed from AI answers. Rebuilds will keep it excluded.')}>Remove source</Button><Button variant="secondary" onClick={() => setDeleting(null)}>Keep source</Button></div></div>}
    </Card>

    {selected && <Card>
      <div className="flex items-start justify-between gap-3"><h2 ref={reviewHeading} className="scroll-mt-6 text-lg font-semibold">Review extracted content</h2><Button variant="ghost" onClick={() => setSelected(null)}>Close</Button></div>
      <p className="my-2 break-all text-sm text-[var(--text-muted)]">{selected.url ?? selected.title} · {selected.status}</p>
      {selected.error && <p role="alert" className="my-2 text-sm text-[var(--danger)]">{selected.error}</p>}
      <details open><summary className="cursor-pointer text-sm font-medium">Published content used by the AI</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--bg-input)] p-4 text-sm">{selected.content || 'No published content yet.'}</pre></details>
      {selected.kind !== 'PAGE' && <div className="mt-4 space-y-3"><Input id={`source-title-${websiteId}`} label="Source title" value={draftTitle} onChange={event => setDraftTitle(event.target.value)} maxLength={200} /><label className="block text-sm font-medium">Edit source text<textarea aria-label="Edit source text" className={`${field} mt-2 min-h-52`} maxLength={200000} value={draft} onChange={event => setDraft(event.target.value)} /></label><Button disabled={Boolean(busy) || !draft.trim() || !draftTitle.trim()} onClick={() => void action('edit', async () => { await api.updateKnowledgeSource(websiteId, selected.id, { title: draftTitle, content: draft }); setSelected(null); }, 'Update queued. Published content changes after indexing succeeds.')}>Save and index changes</Button></div>}
      <details className="mt-4"><summary className="cursor-pointer text-sm">View {selected.chunks.length} indexed sections</summary>{selected.chunks.map(chunk => <div className="mt-3 border-t border-[var(--border)] pt-3" key={chunk.id}><p className="text-sm font-medium">{chunk.heading}</p><p className="mt-1 whitespace-pre-wrap text-sm">{chunk.content}</p></div>)}</details>
    </Card>}

    <div className="grid gap-6 lg:grid-cols-2">
      <Card><h2 className="text-lg font-semibold">Add or refresh one page</h2><p className="my-2 text-sm text-[var(--text-muted)]">Update just this URL. Other pages and uploaded knowledge stay available.</p><form className="space-y-3" onSubmit={event => { event.preventDefault(); void action('page', async () => { await api.addKnowledgePage(websiteId, url); setUrl(''); }, 'Page queued for refresh.'); }}><Input id={`source-url-${websiteId}`} label="Page URL on your website" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/pricing" /><Button loading={busy === 'page'} disabled={Boolean(busy) || !url}>Add / refresh page</Button></form></Card>
      <Card><h2 className="text-lg font-semibold">Upload business knowledge</h2><p className="my-2 text-sm text-[var(--text-muted)]">PDF, TXT, MD, CSV or JSON · up to 5 MB. PDFs need selectable text; up to 150 pages. Extracted text must fit within 200,000 characters.</p><label className="block text-sm font-medium">Choose a file<input aria-label="Knowledge file" ref={fileInput} className="my-3 block w-full text-sm" type="file" accept=".pdf,.txt,.md,.csv,.json" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label><Button loading={busy === 'upload'} disabled={Boolean(busy) || !file} onClick={() => void upload()}>Upload and index</Button></Card>
      <Card><h2 className="mb-3 text-lg font-semibold">Add a custom note</h2><form className="space-y-3" onSubmit={event => { event.preventDefault(); void action('text', async () => { await api.addKnowledgeText(websiteId, title, content); setTitle(''); setContent(''); }, 'Note queued for indexing.'); }}><Input id={`source-note-title-${websiteId}`} label="Title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Updated pricing or refund policy" /><label className="block text-sm font-medium">Business information<textarea aria-label="Business information" className={`${field} mt-2 min-h-36`} required maxLength={200000} value={content} onChange={event => setContent(event.target.value)} /></label><Button loading={busy === 'text'} disabled={Boolean(busy) || !title.trim() || !content.trim()}>Save to knowledge base</Button></form></Card>
      <Card><h2 className="text-lg font-semibold">Keep pages current</h2><p className="my-2 text-sm text-[var(--text-muted)]">Check known, enabled pages for changes automatically. Reuse unchanged sections; failed checks retain the last working content. New website pages are discovered during a full crawl.</p><label className="block text-sm font-medium">Automatic page checks<select aria-label="Automatic page checks" className={`${field} mt-2`} value={inventory?.refreshHours ?? 0} disabled={!inventory || Boolean(busy)} onChange={event => { const hours = Number(event.target.value); void action('schedule', () => api.setKnowledgeRefresh(websiteId, hours), 'Refresh schedule saved.'); }}><option value={0}>Off — refresh manually</option><option value={24}>Daily</option><option value={168}>Weekly</option></select></label><p className="mt-3 text-xs text-[var(--text-muted)]">Source priority applies when matching facts disagree. Disable outdated sources to exclude all their content.</p></Card>
    </div>

    {Boolean(inventory?.conflicts.length) && <Card><h2 className="text-lg font-semibold">Information to review</h2><p className="my-2 text-sm text-[var(--text-muted)]">Possible differences in prices, availability or policies. Different dates or plans can be valid; this check does not detect every conflict.</p>{inventory!.conflicts.map((conflict, index) => <div key={index} className="mt-3 rounded-lg border border-[var(--border)] p-3"><p className="font-medium">{conflict.subject} · {conflict.kind}</p><p className="text-sm">{conflict.resolvedByPriority ? 'Source priority selects the preferred information.' : 'Review these sources and set a priority or disable outdated information.'}</p><ul className="mt-2 text-xs">{conflict.urls.map(sourceUrl => <li key={sourceUrl} className="break-all">{conflictLabel(sourceUrl)}</li>)}</ul></div>)}</Card>}

    <Card><h2 className="text-lg font-semibold">Test your knowledge</h2><p className="my-2 text-sm text-[var(--text-muted)]">Ask a customer question to check the AI answer and inspect retrieved sources. This test does not create a visitor conversation or lead.</p><form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setPreview(null); void action('preview', async () => setPreview(await api.previewKnowledge(websiteId, question)), 'Answer test complete.'); }}><div className="min-w-48 flex-1"><Input id={`source-question-${websiteId}`} label="Customer question" required maxLength={2000} value={question} onChange={event => setQuestion(event.target.value)} placeholder="What does the premium plan cost?" /></div><Button loading={busy === 'preview'} disabled={Boolean(busy) || !question.trim()}>Test answer</Button></form>{preview && <div className="mt-5 space-y-4"><p className="whitespace-pre-wrap text-sm">{preview.answer || 'No answer was generated.'}</p><h3 className="font-medium">Retrieved sources ({preview.sources.length})</h3>{preview.sources.map(source => <details className="rounded-lg border border-[var(--border)] p-3" key={source.id}><summary className="cursor-pointer text-sm">{source.title} · {source.kind}</summary>{source.url && <a className="my-2 block break-all text-xs text-[var(--accent)]" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>}<p className="mt-2 whitespace-pre-wrap text-sm">{source.content}</p></details>)}{Boolean(preview.diagnostics?.conflicts?.length) && <p className="text-sm text-[var(--warning)]">Conflicting information was found. Review source priorities above.</p>}</div>}</Card>
  </div>;
}
