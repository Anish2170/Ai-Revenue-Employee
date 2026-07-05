'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, type KnowledgeBuildHandle } from '@/lib/api';
import { Button, Card, Badge, Spinner } from '@/components/ui';

type Tab = 'instructions' | 'widget' | 'knowledge';

interface Website {
  id: string;
  name: string;
  url: string;
  industry?: string;
  description?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export default function WebsiteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('instructions');
  const [website, setWebsite] = useState<Website | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getWebsite(id).then((w) => setWebsite(w as Website)).catch(() => router.push('/websites')).finally(() => setLoading(false));
  }, [id, router]);

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  if (!website) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'instructions', label: 'Instructions' },
    { key: 'widget', label: 'Widget Install' },
    { key: 'knowledge', label: 'Knowledge Base' },
  ];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.push('/websites')} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
          ← Back
        </button>
        <div>
          <h1 className="text-2xl font-bold">{website.name}</h1>
          <p className="text-[var(--text-muted)] text-sm">{website.url}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--border)] mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t.key
                ? 'border-[var(--accent)] text-[var(--accent)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'instructions' && <InstructionsTab websiteId={id} />}
      {tab === 'widget' && <WidgetTab websiteId={id} />}
      {tab === 'knowledge' && <KnowledgeTab websiteId={id} websiteUrl={website.url} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Instructions Tab
// ---------------------------------------------------------------------------

function InstructionsTab({ websiteId }: { websiteId: string }) {
  const [instructions, setInstructions] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    businessName: '',
    companyDescription: '',
    role: '',
    tone: '',
    goal: '',
    context: '',
    rules: '',
    fallbackMessage: '',
    preferredCta: '',
    supportEmail: '',
    supportPhone: '',
    websiteUrl: '',
  });
  const [alwaysBookDemo, setAlwaysBookDemo] = useState(false);
  const [avoidDiscounts, setAvoidDiscounts] = useState(false);

  useEffect(() => {
    api.getInstructions(websiteId)
      .then((data) => {
        const d = data as AnyRecord;
        setInstructions(d);
        setForm({
          businessName: d?.businessName || '',
          companyDescription: d?.companyDescription || '',
          role: d?.role || '',
          tone: d?.tone || '',
          goal: d?.goal || '',
          context: d?.context || '',
          rules: d?.rules || '',
          fallbackMessage: d?.fallbackMessage || '',
          preferredCta: d?.preferredCta || '',
          supportEmail: d?.supportEmail || '',
          supportPhone: d?.supportPhone || '',
          websiteUrl: d?.websiteUrl || '',
        });
        setAlwaysBookDemo(d?.alwaysBookDemo ?? false);
        setAvoidDiscounts(d?.avoidDiscounts ?? false);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [websiteId]);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.updateInstructions(websiteId, {
        ...form,
        alwaysBookDemo,
        avoidDiscounts,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  const textFields = [
    { key: 'businessName', label: 'Business Name', placeholder: 'e.g. Colour Trading' },
    { key: 'companyDescription', label: 'Company Description', placeholder: 'What does your business do?' },
    { key: 'role', label: 'Role', placeholder: 'e.g. Friendly sales assistant for a SaaS product' },
    { key: 'tone', label: 'Tone', placeholder: 'e.g. Professional, helpful, and concise.' },
    { key: 'goal', label: 'Goal', placeholder: 'e.g. Help visitors understand pricing and book a demo' },
    { key: 'context', label: 'Context', placeholder: 'Additional context about your business...' },
    { key: 'rules', label: 'Rules', placeholder: 'e.g. Never mention competitors. Always suggest booking a call.' },
    { key: 'fallbackMessage', label: 'Fallback Message', placeholder: "e.g. I'm not sure about that, but our team can help!" },
    { key: 'preferredCta', label: 'Preferred CTA', placeholder: 'e.g. Book a Demo, Contact Us' },
    { key: 'supportEmail', label: 'Support Email', placeholder: 'e.g. support@yourcompany.com' },
    { key: 'supportPhone', label: 'Support Phone', placeholder: 'e.g. +1-555-123-4567' },
    { key: 'websiteUrl', label: 'Website URL', placeholder: 'e.g. https://yourcompany.com' },
  ];

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-4">AI Behavior Instructions</h2>
      <p className="text-[var(--text-muted)] text-sm mb-6">
        Configure how the AI assistant behaves on your website.
      </p>
      <div className="space-y-4">
        {textFields.map(({ key, label, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium mb-1">{label}</label>
            <textarea
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)] min-h-[80px] resize-y"
              value={form[key as keyof typeof form]}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              placeholder={placeholder}
            />
          </div>
        ))}

        {/* Toggle options */}
        <div className="flex gap-6 pt-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={alwaysBookDemo}
              onChange={(e) => setAlwaysBookDemo(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Always suggest booking a demo
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={avoidDiscounts}
              onChange={(e) => setAvoidDiscounts(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Avoid mentioning discounts
          </label>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-6">
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Save Instructions
        </Button>
        {saved && <span className="text-sm text-[var(--success)]">✓ Saved</span>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Widget Tab
// ---------------------------------------------------------------------------

function WidgetTab({ websiteId }: { websiteId: string }) {
  const [widget, setWidget] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getWidget(websiteId)
      .then((data) => setWidget(data as AnyRecord))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [websiteId]);

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!widget) return <Card><p className="text-[var(--text-muted)]">No widget found.</p></Card>;

  const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';
  const snippet = `<script src="${backendUrl}/widget.js" data-site-id="${widget.siteId}" defer></script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold mb-2">Install Widget</h2>
      <p className="text-[var(--text-muted)] text-sm mb-4">
        Paste this snippet before the closing <code>&lt;/body&gt;</code> tag on your website.
      </p>
      <div className="relative">
        <pre className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 text-sm overflow-x-auto text-[var(--text)]">
          {snippet}
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 text-xs px-3 py-1.5 rounded-md bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-6 space-y-2 text-sm text-[var(--text-muted)]">
        <p><strong>Site ID:</strong> <code className="text-[var(--text)]">{widget.siteId}</code></p>
        <p><strong>Status:</strong>{' '}
          <Badge variant={widget.status === 'ACTIVE' ? 'success' : 'warning'}>
            {widget.status === 'ACTIVE' ? 'Active' : 'Disabled'}
          </Badge>
        </p>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Knowledge Tab
// ---------------------------------------------------------------------------

function KnowledgeTab({ websiteId, websiteUrl }: { websiteId: string; websiteUrl: string }) {
  const [status, setStatus] = useState<AnyRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [buildUrl, setBuildUrl] = useState('');
  const [phases, setPhases] = useState<{ phase: string; detail?: AnyRecord }[]>([]);
  const [error, setError] = useState('');
  const handleRef = useRef<KnowledgeBuildHandle | null>(null);

  const fetchStatus = useCallback(() => {
    api.getKnowledgeStatus(websiteId)
      .then((data) => setStatus(data as AnyRecord))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [websiteId]);

  useEffect(() => {
    fetchStatus();
    setBuildUrl(websiteUrl);
  }, [fetchStatus, websiteUrl]);

  const startBuild = () => {
    if (!buildUrl) return;
    setBuilding(true);
    setPhases([]);
    setError('');

    const handle = api.buildKnowledge(websiteId, buildUrl)
      .onPhase((phase, data) => {
        setPhases((prev) => [...prev, { phase, detail: data as AnyRecord }]);
      })
      .onComplete((data) => {
        setPhases((prev) => [...prev, { phase: 'complete', detail: data as AnyRecord }]);
        setBuilding(false);
        fetchStatus();
      })
      .onError((err) => {
        setError(err.message);
        setBuilding(false);
      });

    handleRef.current = handle;
    handle.start();
  };

  if (loading) return <div className="flex justify-center py-12"><Spinner /></div>;

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">Knowledge Base Status</h2>
        {status?.hasKnowledge ? (
          <div className="space-y-2 text-sm">
            <p><Badge variant="success">Ready</Badge></p>
            <p className="text-[var(--text-muted)]">
              {status.snapshot.pagesCrawled} pages · {status.snapshot.chunkCount} chunks · Model: {status.snapshot.embeddingModel}
            </p>
            <p className="text-[var(--text-muted)]">
              Source: {status.snapshot.sourceUrl}
            </p>
            <p className="text-[var(--text-muted)]">
              Built: {new Date(status.snapshot.createdAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-sm">No knowledge base built yet. Crawl your website below to get started.</p>
        )}
      </Card>

      {/* Build */}
      <Card>
        <h2 className="text-lg font-semibold mb-4">{status?.hasKnowledge ? 'Rebuild Knowledge' : 'Build Knowledge Base'}</h2>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-1">URL to crawl</label>
            <input
              className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] text-sm focus:outline-none focus:border-[var(--accent)]"
              value={buildUrl}
              onChange={(e) => setBuildUrl(e.target.value)}
              placeholder="https://example.com"
              disabled={building}
            />
          </div>
          <Button variant="primary" onClick={startBuild} loading={building} disabled={building || !buildUrl}>
            {building ? 'Building…' : status?.hasKnowledge ? 'Rebuild' : 'Start Build'}
          </Button>
        </div>

        {error && <p className="text-[var(--danger)] text-sm mt-3">{error}</p>}

        {phases.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-sm font-medium">Build Progress</p>
            <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 max-h-64 overflow-y-auto text-sm font-mono space-y-1">
              {phases.map((p, i) => (
                <div key={i} className="flex gap-2 text-[var(--text-muted)]">
                  <span className="text-[var(--accent)]">▸</span>
                  <span>{p.phase}</span>
                  {p.detail && Object.keys(p.detail).length > 0 && (
                    <span className="text-[var(--text-muted)]">
                      — {Object.entries(p.detail).map(([k, v]) => `${k}: ${v}`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
              {building && (
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <Spinner className="h-3 w-3" />
                  <span>Working…</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
