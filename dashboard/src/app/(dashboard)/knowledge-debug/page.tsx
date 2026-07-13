'use client';

/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Button, Card, Input, Spinner } from '@/components/ui';

type Website = { id: string; name: string; url: string };
const SELECTED_WEBSITE_STORAGE_KEY = 'dashboard:selectedWebsiteId';
type PageRow = { url: string; title: string; crawlStatus: string; httpStatus: number | null; wordCount: number; extractedTextLength: number; cleanedTextLength: number; chunkCount: number; lastCrawled: string; lastEmbedded: string; debugCaptured: boolean };
type ChunkRow = { number: number; id: string; tokenCount: number; characterCount: number; embeddingStatus: string; pageUrl: string; preview: string };
type Paginated<T> = { items: T[]; pagination: { page: number; limit: number; total: number; pages: number } };
type DiscoveredAction = { intent: string; detectedLabel: string; resolvedUrl: string; confidence: number; detectionMethod: string; rule: string | null; page: string; whySelected: string; alternativeCandidates: Array<{ label: string; url: string; confidence: number; detectionMethod: string; page: string; why: string }> };

type SearchResult = {
  retrievedChunks: Array<{ similarityScore: number; chunkId: string; pageUrl: string; preview: string; fullChunk: string; keptForPrompt: boolean }>;
  finalLlmContext: Record<string, unknown>;
  rawGeminiResponse: string;
  llmError: string | null;
  timings: Record<string, number>;
};

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

function Pre({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-lg border p-4 text-xs leading-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text)' }}>{text}</pre>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <Card className="space-y-4"><h2 className="text-lg font-semibold" style={{ color: 'var(--text)' }}>{title}</h2>{children}</Card>;
}

export default function KnowledgeDebugPage() {
  const [websites, setWebsites] = useState<Website[]>([]);
  const [websiteId, setWebsiteId] = useState('');
  const [overview, setOverview] = useState<any>(null);
  const [pages, setPages] = useState<Paginated<PageRow> | null>(null);
  const [chunks, setChunks] = useState<Paginated<ChunkRow> | null>(null);
  const [pagePage, setPagePage] = useState(1);
  const [chunkPage, setChunkPage] = useState(1);
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [pageDetail, setPageDetail] = useState<any>(null);
  const [expandedChunk, setExpandedChunk] = useState<string | null>(null);
  const [chunkDetail, setChunkDetail] = useState<any>(null);
  const [question, setQuestion] = useState('How do I install the widget?');
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [quality, setQuality] = useState<any[]>([]);
  const [actions, setActions] = useState<DiscoveredAction[]>([]);
  const [flow, setFlow] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listWebsites().then((data: any) => {
      const sites = data as Website[];
      setWebsites(sites);
      const storedWebsiteId = window.localStorage.getItem(SELECTED_WEBSITE_STORAGE_KEY);
      const selected = sites.find((site) => site.id === storedWebsiteId) ?? sites[0];
      if (selected) setWebsiteId(selected.id);
    });
  }, []);

  useEffect(() => {
    if (!websiteId) return;
    setLoading(true);
    Promise.all([
      api.getKnowledgeDebugOverview(websiteId),
      api.getKnowledgeDebugPages(websiteId, pagePage, 20),
      api.getKnowledgeDebugChunks(websiteId, chunkPage, 20),
      api.getKnowledgeDebugQualityChecks(websiteId),
      api.getKnowledgeDebugActions(websiteId),
      api.getKnowledgeDebugVisualFlow(websiteId),
    ]).then(([o, p, c, q, a, f]: any[]) => {
      setOverview(o); setPages(p); setChunks(c); setQuality(q); setActions(a.items ?? []); setFlow(f);
    }).finally(() => setLoading(false));
  }, [websiteId, pagePage, chunkPage]);

  const selectedWebsite = useMemo(() => websites.find((site) => site.id === websiteId), [websites, websiteId]);

  async function openPage(url: string) {
    if (expandedPage === url) { setExpandedPage(null); return; }
    setExpandedPage(url); setPageDetail(null);
    setPageDetail(await api.getKnowledgeDebugPageDetail(websiteId, url));
  }

  async function openChunk(id: string) {
    if (expandedChunk === id) { setExpandedChunk(null); return; }
    setExpandedChunk(id); setChunkDetail(null);
    setChunkDetail(await api.getKnowledgeDebugChunkDetail(websiteId, id));
  }

  async function testRetrieval() {
    setLoading(true);
    try { setSearch(await api.runKnowledgeDebugSearch(websiteId, question) as SearchResult); }
    finally { setLoading(false); }
  }

  const exportUrl = (format: string) => `${BASE_URL}/api/websites/${websiteId}/knowledge/debug/export?format=${format}`;

  return <div className="space-y-6">
    <div className="flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Knowledge Debug</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Read-only RAG pipeline inspection for developers and admins.</p>
      </div>
      <label className="flex min-w-80 flex-col gap-1 text-sm" style={{ color: 'var(--text)' }}>
        Website
        <select className="rounded-lg border px-3 py-2" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)' }} value={websiteId} onChange={(e) => { window.localStorage.setItem(SELECTED_WEBSITE_STORAGE_KEY, e.target.value); setWebsiteId(e.target.value); }}>
          {websites.map((site) => <option key={site.id} value={site.id}>{site.name} - {site.url}</option>)}
        </select>
      </label>
    </div>

    {loading && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}><Spinner className="h-4 w-4" /> Loading debug data</div>}

    <Section title="Snapshot">
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-6" style={{ color: 'var(--text)' }}>
        {['pages','chunks','dimensions','embeddingModel','createdAt','debugPagesCaptured'].map((key) => <div key={key} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}><div className="text-xs" style={{ color: 'var(--text-muted)' }}>{key}</div><div className="truncate">{overview?.snapshot?.[key] ?? 'n/a'}</div></div>)}
      </div>
      {overview?.hasSnapshot && !overview.snapshot.debugPagesCaptured && <Badge variant="warning">Existing snapshot lacks raw crawler debug text. Rebuild knowledge to capture complete page diagnostics.</Badge>}
    </Section>

    <Section title="Visual Flow">
      <div className="flex flex-wrap items-center gap-2">
        {flow.map((stage, index) => <button key={stage.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }} onClick={() => document.getElementById(stage.id)?.scrollIntoView({ behavior: 'smooth' })}>{stage.label} <span style={{ color: 'var(--text-muted)' }}>({stage.count})</span>{index < flow.length - 1 ? ' ?' : ''}</button>)}
      </div>
    </Section>

    <Section title="Crawled Pages">
      <div id="crawler" className="overflow-auto"><table className="w-full text-left text-sm" style={{ color: 'var(--text)' }}><thead><tr style={{ color: 'var(--text-muted)' }}>{['URL','Title','Crawl Status','HTTP','Words','Extracted','Chunks','Last Crawled','Last Embedded'].map((h) => <th key={h} className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{h}</th>)}</tr></thead><tbody>{pages?.items.map((row) => <tr key={row.url} className="align-top"><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}><button className="text-left underline" onClick={() => openPage(row.url)}>{row.url}</button></td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.title}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.crawlStatus}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.httpStatus ?? 'n/a'}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.wordCount}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.extractedTextLength}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.chunkCount}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.lastCrawled}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.lastEmbedded}</td></tr>)}</tbody></table></div>
      <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={(pages?.pagination.page ?? 1) <= 1} onClick={() => setPagePage((p) => Math.max(1, p - 1))}>Previous</Button><Button variant="secondary" size="sm" disabled={(pages?.pagination.page ?? 1) >= (pages?.pagination.pages ?? 1)} onClick={() => setPagePage((p) => p + 1)}>Next</Button></div>
      {expandedPage && <div className="space-y-3">{pageDetail ? <><h3 className="font-medium" style={{ color: 'var(--text)' }}>Raw extracted text</h3><Pre value={pageDetail.rawExtractedText ?? 'Not captured in this snapshot.'} /><h3 id="cleaned-text" className="font-medium" style={{ color: 'var(--text)' }}>Cleaned text and removal flags</h3><Pre value={{ beforeAfterLengths: { before: pageDetail.cleaning.beforeLength, after: pageDetail.cleaning.afterLength }, cleaning: pageDetail.cleaning, cleanedText: pageDetail.cleanedText }} /></> : <Spinner />}</div>}
    </Section>

    <Section title="Chunks">
      <div id="chunks" className="overflow-auto"><table className="w-full text-left text-sm" style={{ color: 'var(--text)' }}><thead><tr style={{ color: 'var(--text-muted)' }}>{['#','Chunk ID','Tokens','Characters','Embedding','Page','Preview'].map((h) => <th key={h} className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{h}</th>)}</tr></thead><tbody>{chunks?.items.map((row) => <tr key={row.id} className="align-top"><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.number}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}><button className="underline" onClick={() => openChunk(row.id)}>{row.id}</button></td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.tokenCount}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.characterCount}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.embeddingStatus}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.pageUrl}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{row.preview}</td></tr>)}</tbody></table></div>
      <div className="flex gap-2"><Button variant="secondary" size="sm" disabled={(chunks?.pagination.page ?? 1) <= 1} onClick={() => setChunkPage((p) => Math.max(1, p - 1))}>Previous</Button><Button variant="secondary" size="sm" disabled={(chunks?.pagination.page ?? 1) >= (chunks?.pagination.pages ?? 1)} onClick={() => setChunkPage((p) => p + 1)}>Next</Button></div>
      {expandedChunk && <div>{chunkDetail ? <Pre value={chunkDetail.content} /> : <Spinner />}</div>}
    </Section>

    <Section title="Search Test">
      <div className="flex items-end gap-3"><Input label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} className="min-w-[420px]" /><Button onClick={testRetrieval} loading={loading}>Test Retrieval</Button></div>
      {search && <div className="space-y-4"><div id="retrieved-chunks" className="space-y-2">{search.retrievedChunks.map((chunk) => <details key={chunk.chunkId} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><summary className="cursor-pointer">{chunk.similarityScore} - {chunk.chunkId} - {chunk.pageUrl} {chunk.keptForPrompt ? '(in prompt)' : ''}<div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{chunk.preview}</div></summary><Pre value={chunk.fullChunk} /></details>)}</div><div id="prompt"><h3 className="font-medium" style={{ color: 'var(--text)' }}>Final LLM Context</h3><Pre value={search.finalLlmContext} /></div><div id="gemini"><h3 className="font-medium" style={{ color: 'var(--text)' }}>Raw Gemini Response</h3><Pre value={search.llmError ? `ERROR: ${search.llmError}\n\n${search.rawGeminiResponse}` : search.rawGeminiResponse} /></div><div id="answer"><h3 className="font-medium" style={{ color: 'var(--text)' }}>Pipeline Timing</h3><Pre value={search.timings} /></div></div>}
    </Section>


    <Section title="Discovered Website Actions">
      <div className="overflow-auto"><table className="w-full text-left text-sm" style={{ color: 'var(--text)' }}><thead><tr style={{ color: 'var(--text-muted)' }}>{['Intent','Detected Label','Resolved URL','Confidence','Method','Page','Why selected','Alternatives'].map((h) => <th key={h} className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{h}</th>)}</tr></thead><tbody>{actions.map((action) => <tr key={`${action.intent}-${action.resolvedUrl}`} className="align-top"><td className="border-b p-2 font-mono" style={{ borderColor: 'var(--border)' }}>{action.intent}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{action.detectedLabel}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{action.resolvedUrl}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{Math.round(action.confidence * 100)}%</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{action.detectionMethod}{action.rule ? `: ${action.rule}` : ''}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{action.page}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{action.whySelected}</td><td className="border-b p-2" style={{ borderColor: 'var(--border)' }}>{action.alternativeCandidates.length ? <details><summary>{action.alternativeCandidates.length} candidates</summary><Pre value={action.alternativeCandidates} /></details> : 'none'}</td></tr>)}</tbody></table></div>
      {actions.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No action graph found. Rebuild knowledge to run crawl-time action discovery.</p>}
    </Section>
    <Section title="Quality Checks">
      <div className="grid gap-2">{quality.map((check, index) => <div key={index} className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><Badge variant={check.severity === 'danger' ? 'danger' : check.severity === 'warning' ? 'warning' : 'neutral'}>{check.type}</Badge> <span>{check.message}</span> <span style={{ color: 'var(--text-muted)' }}>{check.url ?? check.chunkId}</span></div>)}</div>
    </Section>

    <Section title="Download">
      <div className="flex gap-2">{['json','markdown','txt'].map((format) => <a key={format} href={exportUrl(format)}><Button variant="secondary">Export {format.toUpperCase()}</Button></a>)}</div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Exports are read-only snapshots of the debug session for {selectedWebsite?.name ?? 'the selected website'}.</p>
    </Section>
  </div>;
}


