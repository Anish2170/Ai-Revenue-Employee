'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, type KnowledgeBuildHandle } from '@/lib/api';
import { Badge, Button, Card, Input, Spinner } from '@/components/ui';

type Website = { id: string; name: string; url: string; industry?: string; description?: string };
type Widget = { siteId: string; status: string; scriptSnippet?: string };
type InstructionForm = {
  businessName: string;
  companyDescription: string;
  role: string;
  tone: string;
  goal: string;
  context: string;
  rules: string;
  fallbackMessage: string;
  preferredCta: string;
  supportEmail: string;
  supportPhone: string;
  websiteUrl: string;
};

type InstructionPayload = Partial<InstructionForm> & {
  alwaysBookDemo?: boolean;
  avoidDiscounts?: boolean;
};
type ActionRow = {
  id: string;
  intent: string;
  actionLabel: string;
  destinationUrl: string;
  automaticDestinationUrl: string;
  hasManualOverride: boolean;
  overrideUrl: string | null;
  details: { selectableUrls: string[] };
};
type ActionsPayload = { actions: ActionRow[]; summary?: { discoveredActions: number; needsReview: number } };
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Platform = 'html' | 'wordpress' | 'shopify' | 'react' | 'nextjs' | 'webflow' | 'framer' | 'other';

const steps = [
  'Create Website',
  'Paste URL',
  'Build Knowledge',
  'AI Ready',
  'Instructions',
  'Actions',
  'Test AI',
  'Install',
  'Done',
];

const buildStages = [
  { key: 'crawler', label: 'Crawler', match: ['crawl', 'extract'] },
  { key: 'chunking', label: 'Chunking', match: ['chunk'] },
  { key: 'embeddings', label: 'Embeddings', match: ['embed', 'index', 'saving'] },
  { key: 'actions', label: 'Website Actions', match: ['action'] },
  { key: 'completed', label: 'Completed', match: ['complete'] },
];
const emptyInstructionForm: InstructionForm = {
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
};

const instructionTextFields: Array<{ key: keyof InstructionForm; label: string; placeholder: string }> = [
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

const platforms: Array<{ id: Platform; label: string }> = [
  { id: 'html', label: 'HTML Website' },
  { id: 'wordpress', label: 'WordPress' },
  { id: 'shopify', label: 'Shopify' },
  { id: 'react', label: 'React' },
  { id: 'nextjs', label: 'Next.js' },
  { id: 'webflow', label: 'Webflow' },
  { id: 'framer', label: 'Framer' },
  { id: 'other', label: 'Other' },
];

const platformGuides: Record<Platform, string[]> = {
  html: ['Copy the widget code.', 'Paste it before the closing </body> tag.', 'Save the file.', 'Deploy your website.'],
  wordpress: ['Log in to WordPress.', 'Install WPCode or Insert Headers & Footers.', 'Paste the widget code before </body>.', 'Save your changes.'],
  shopify: ['Open Online Store.', 'Choose Themes.', 'Click Edit Code.', 'Open theme.liquid.', 'Paste the widget code before </body>.'],
  react: ['Load the widget script once in your global HTML template.', 'For Vite or CRA, paste it in public/index.html before </body>.', 'Deploy the updated app.'],
  nextjs: ['Open your root layout.', 'Add the script in app/layout.tsx using next/script.', 'Keep the data-site-id attribute exactly as shown.', 'Deploy the app.'],
  webflow: ['Open Site Settings.', 'Go to Custom Code.', 'Paste the widget code in Footer Code.', 'Publish the site.'],
  framer: ['Open Site Settings.', 'Go to Custom Code.', 'Paste the script in the end of body area.', 'Publish the site.'],
  other: ['Copy the widget code.', 'Paste it before the closing </body> tag.', 'Save your changes.', 'Deploy or publish your website.'],
};

function normalizeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function intentLabel(intent: string) {
  return intent.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function questionForAction(action: Pick<ActionRow, 'intent' | 'actionLabel'>): string {
  const intent = action.intent.toLowerCase();
  const label = action.actionLabel || intentLabel(action.intent);
  if (intent.includes('pricing')) return 'What are your pricing options?';
  if (intent.includes('book') || intent.includes('demo') || intent.includes('consult')) return `How can I ${label.toLowerCase()}?`;
  if (intent.includes('contact')) return 'How can I contact your team?';
  if (intent.includes('service') || intent.includes('program')) return 'Tell me about your services.';
  if (intent.includes('team') || intent.includes('doctor') || intent.includes('trainer')) return `Tell me about ${label.toLowerCase()}.`;
  return `Tell me about ${label}.`;
}

function uniqueQuestions(questions: string[]): string[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = question.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stageState(stage: (typeof buildStages)[number], phases: string[], complete: boolean) {
  if (stage.key === 'completed' && complete) return 'done';
  if (stage.key === 'actions' && complete) return 'done';
  const hit = phases.some((phase) => stage.match.some((needle) => phase.toLowerCase().includes(needle)));
  return hit ? 'done' : 'pending';
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Spinner /></div>}>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const params = useSearchParams();
  const initialWebsiteId = params.get('websiteId') ?? '';
  const [step, setStep] = useState(initialWebsiteId ? 1 : 0);
  const [websites, setWebsites] = useState<Website[]>([]);
  const [website, setWebsite] = useState<Website | null>(null);
  const [websiteId, setWebsiteId] = useState(initialWebsiteId);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(!initialWebsiteId);
  const [createForm, setCreateForm] = useState({ name: '', url: '', industry: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildComplete, setBuildComplete] = useState(false);
  const [phases, setPhases] = useState<string[]>([]);
  const [buildError, setBuildError] = useState('');
  const [instructionForm, setInstructionForm] = useState<InstructionForm>(emptyInstructionForm);
  const [alwaysBookDemo, setAlwaysBookDemo] = useState(false);
  const [avoidDiscounts, setAvoidDiscounts] = useState(false);
  const [savingInstructions, setSavingInstructions] = useState(false);
  const [actionsPayload, setActionsPayload] = useState<ActionsPayload | null>(null);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [editingAction, setEditingAction] = useState<ActionRow | null>(null);
  const [selectedUrl, setSelectedUrl] = useState('');
  const [savingAction, setSavingAction] = useState(false);
  const [widget, setWidget] = useState<Widget | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [platform, setPlatform] = useState<Platform>('html');
  const [copied, setCopied] = useState(false);
  const [verifyState, setVerifyState] = useState<'idle' | 'checking' | 'installed' | 'missing'>('idle');
  const [verifyMessage, setVerifyMessage] = useState('');
  const [error, setError] = useState('');
  const buildHandle = useRef<KnowledgeBuildHandle | null>(null);

  const loadWebsite = useCallback(async (id: string) => {
    const site = (await api.getWebsite(id)) as Website;
    setWebsite(site);
    setWebsiteId(site.id);
    setUrl(site.url);
    return site;
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const sites = (await api.listWebsites()) as Website[];
        setWebsites(sites);
        const selected = initialWebsiteId || sites[0]?.id || '';
        if (selected) await loadWebsite(selected);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load onboarding.');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [initialWebsiteId, loadWebsite]);

  useEffect(() => {
    if (!websiteId) return;
    void api.getWidget(websiteId).then((data) => setWidget(data as Widget)).catch(() => undefined);
  }, [websiteId]);

  useEffect(() => {
    if (!websiteId || step !== 4) return;
    void api.getInstructions(websiteId).then((data) => {
      const loaded = data as InstructionPayload;
      setInstructionForm({
        businessName: loaded.businessName || website?.name || '',
        companyDescription: loaded.companyDescription || '',
        role: loaded.role || '',
        tone: loaded.tone || '',
        goal: loaded.goal || '',
        context: loaded.context || '',
        rules: loaded.rules || '',
        fallbackMessage: loaded.fallbackMessage || '',
        preferredCta: loaded.preferredCta || '',
        supportEmail: loaded.supportEmail || '',
        supportPhone: loaded.supportPhone || '',
        websiteUrl: loaded.websiteUrl || website?.url || '',
      });
      setAlwaysBookDemo(loaded.alwaysBookDemo ?? false);
      setAvoidDiscounts(loaded.avoidDiscounts ?? false);
    }).catch(() => undefined);
  }, [website?.name, website?.url, websiteId, step]);

  const loadActions = useCallback(async () => {
    if (!websiteId) return;
    setActionsLoading(true);
    try {
      setActionsPayload((await api.getDiscoveredWebsiteActions(websiteId)) as ActionsPayload);
    } finally {
      setActionsLoading(false);
    }
  }, [websiteId]);

  useEffect(() => {
    if ((step === 5 || step === 6) && !actionsPayload) void Promise.resolve().then(loadActions);
  }, [actionsPayload, step, loadActions]);
  useEffect(() => {
    if (!websiteId || step !== 2 || building) return;
    void Promise.resolve().then(async () => {
      try {
        const status = (await api.getKnowledgeStatus(websiteId)) as { hasKnowledge?: boolean; latestBuild?: { status?: string } };
        if (status.hasKnowledge || status.latestBuild?.status === 'SUCCESS') {
          setBuildComplete(true);
          setBuilding(false);
          setPhases((prev) => (prev.includes('complete') ? prev : [...prev, 'complete']));
          setStep(3);
        }
      } catch {
        // Stay on the build step if status is unavailable.
      }
    });
  }, [building, step, websiteId]);

  const snippet = useMemo(() => {
    if (!widget) return '';
    const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';
    return widget.scriptSnippet || `<script src="${backendUrl}/widget.js" data-site-id="${widget.siteId}" defer></script>`;
  }, [widget]);

  const suggestedQuestions = useMemo(() => {
    const actionQuestions = (actionsPayload?.actions ?? [])
      .slice(0, 6)
      .map((action) => questionForAction(action));
    const actionIntents = (actionsPayload?.actions ?? []).map((action) => `${action.intent} ${action.actionLabel}`.toLowerCase()).join(' ');
    const businessText = `${website?.industry ?? ''} ${website?.description ?? ''} ${actionIntents}`.toLowerCase();

    const fallbackQuestions = businessText.includes('doctor') || businessText.includes('clinic') || businessText.includes('health')
      ? ['What services do you offer?', 'How can I book a consultation?', 'Do you offer emergency appointments?']
      : businessText.includes('law') || businessText.includes('legal') || businessText.includes('attorney')
        ? ['What legal services do you offer?', 'How do consultations work?', 'What are your pricing options?']
        : businessText.includes('gym') || businessText.includes('fitness') || businessText.includes('trainer')
          ? ['What training programs do you offer?', 'What are your membership prices?', 'How can I book an assessment?']
          : ['What services do you offer?', 'What are your pricing options?', 'How can I book a consultation?'];

    return uniqueQuestions([...actionQuestions, ...fallbackQuestions]).slice(0, 4);
  }, [actionsPayload, website]);

  async function createWebsite(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError('');
    try {
      const created = (await api.createWebsite({
        name: createForm.name,
        url: normalizeUrl(createForm.url),
        ...(createForm.industry && { industry: createForm.industry }),
        ...(createForm.description && { description: createForm.description }),
      })) as Website;
      setWebsites((prev) => [created, ...prev]);
      setWebsite(created);
      setWebsiteId(created.id);
      setUrl(created.url);
      setCreateOpen(false);
      setStep(1);
      router.replace(`/onboarding?websiteId=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create website.');
    } finally {
      setCreating(false);
    }
  }

  async function saveWebsiteUrl() {
    if (!websiteId || !website) return;
    const nextUrl = normalizeUrl(url);
    setSavingUrl(true);
    setError('');
    try {
      const updated = (await api.updateWebsite(websiteId, { url: nextUrl })) as Website;
      setWebsite(updated);
      setUrl(updated.url);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save website URL.');
    } finally {
      setSavingUrl(false);
    }
  }

  function startKnowledgeBuild() {
    if (!websiteId || !url) return;
    setBuilding(true);
    setBuildComplete(false);
    setPhases([]);
    setBuildError('');
    const finishBuild = () => {
      setPhases((prev) => (prev.includes('complete') ? prev : [...prev, 'complete']));
      setBuildComplete(true);
      setBuilding(false);
      setTimeout(() => setStep(3), 650);
    };

    const handle = api.buildKnowledge(websiteId, normalizeUrl(url))
      .onPhase((phase) => {
        setPhases((prev) => [...prev, phase]);
        if (phase === 'complete' || phase.endsWith(':complete')) finishBuild();
      })
      .onComplete(finishBuild)
      .onError((err) => {
        setBuildError(err.message);
        setBuilding(false);
      });
    buildHandle.current = handle;
    handle.start();
  }

  async function saveInstructions(skip = false) {
    if (!websiteId) return;
    setSavingInstructions(true);
    try {
      if (!skip) {
        await api.updateInstructions(websiteId, {
          ...instructionForm,
          businessName: instructionForm.businessName || website?.name || 'Your Business',
          websiteUrl: instructionForm.websiteUrl || website?.url,
          alwaysBookDemo,
          avoidDiscounts,
        });
      }
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save instructions.');
    } finally {
      setSavingInstructions(false);
    }
  }

  function openActionEditor(action: ActionRow) {
    setEditingAction(action);
    setSelectedUrl(action.destinationUrl);
  }

  async function saveActionUrl() {
    if (!websiteId || !editingAction || !selectedUrl) return;
    setSavingAction(true);
    try {
      await api.updateDiscoveredActionUrlOverride(websiteId, editingAction.intent, selectedUrl);
      await loadActions();
      setEditingAction(null);
    } finally {
      setSavingAction(false);
    }
  }

  async function sendChat(question?: string) {
    if (!widget) return;
    const content = (question ?? chatInput).trim();
    if (!content) return;
    const nextMessages: ChatMessage[] = [...chatMessages, { role: 'user', content }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);
    try {
      const response = (await api.sendTestChat(widget.siteId, [{ role: 'user', content }])) as { reply: string };
      setChatMessages([...nextMessages, { role: 'assistant', content: response.reply || 'I could not generate a response.' }]);
    } catch (err) {
      setChatMessages([...nextMessages, { role: 'assistant', content: err instanceof Error ? err.message : 'Test chat failed.' }]);
    } finally {
      setChatLoading(false);
    }
  }

  async function copySnippet() {
    if (!snippet) return;
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function verifyInstall() {
    if (!websiteId) return;
    setVerifyState('checking');
    setVerifyMessage('');
    try {
      const result = (await api.verifyWidgetInstallation(websiteId)) as { installed: boolean; reason?: string; checkedUrl?: string };
      setVerifyState(result.installed ? 'installed' : 'missing');
      setVerifyMessage(result.reason || 'Verification completed.');
      if (result.installed) setStep(8);
    } catch (err) {
      setVerifyState('missing');
      setVerifyMessage(err instanceof Error ? err.message : 'Verification failed.');
    }
  }

  if (loading) return <div className="flex h-64 items-center justify-center"><Spinner /></div>;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--accent-hover)' }}>Guided setup</p>
          <h1 className="mt-2 text-3xl font-semibold" style={{ color: 'var(--text)' }}>Launch your AI Employee</h1>
          <p className="mt-2 max-w-2xl text-sm" style={{ color: 'var(--text-muted)' }}>A focused first-time setup from website URL to live widget in under five minutes.</p>
        </div>
        {website && (
          <select
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
            value={websiteId}
            onChange={(event) => void loadWebsite(event.target.value)}
          >
            {websites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        )}
      </header>

      <div className="grid gap-2 md:grid-cols-9">
        {steps.map((label, index) => (
          <div key={label} className="rounded-lg border p-3" style={{ borderColor: index <= step ? 'var(--accent)' : 'var(--border)', background: index === step ? 'rgba(24, 69, 59, 0.10)' : 'var(--bg-card)' }}>
            <div className="text-xs" style={{ color: index <= step ? 'var(--accent-hover)' : 'var(--text-muted)' }}>Step {index + 1}</div>
            <div className="mt-1 text-xs font-medium" style={{ color: 'var(--text)' }}>{label}</div>
          </div>
        ))}
      </div>

      {error && <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: 'var(--danger)', background: 'rgba(239,68,68,0.12)' }}>{error}</div>}

      {step === 0 && (
        <Card className="rounded-lg">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-xl font-semibold">Create Website</h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Use the existing website creation flow to start the setup.</p>
            </div>
            {websites.length > 0 && <Button variant="secondary" onClick={() => setStep(1)}>Use existing website</Button>}
          </div>
          {createOpen && (
            <form onSubmit={createWebsite} className="mt-6 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Input label="Website Name" value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} placeholder="My Website" required />
                <Input label="URL" value={createForm.url} onChange={(e) => setCreateForm({ ...createForm, url: e.target.value })} placeholder="https://example.com" required />
                <Input label="Industry" value={createForm.industry} onChange={(e) => setCreateForm({ ...createForm, industry: e.target.value })} placeholder="SaaS, healthcare, real estate" />
                <Input label="Description" value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} placeholder="Brief business description" />
              </div>
              <Button type="submit" loading={creating}>Create Website</Button>
            </form>
          )}
        </Card>
      )}

      {step === 1 && website && (
        <Card className="rounded-lg">
          <h2 className="text-xl font-semibold">Paste Website URL</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Confirm the public website your AI should learn from.</p>
          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-end">
            <Input className="min-w-0 md:min-w-[520px]" label="Website URL" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
            <Button onClick={saveWebsiteUrl} loading={savingUrl}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 2 && (
        <Card className="rounded-lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Building Knowledge...</h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Crawler, chunking, embeddings, and Website Actions run through the existing build system.</p>
            </div>
            <Button onClick={startKnowledgeBuild} loading={building} disabled={building || !url}>{building ? 'Building' : buildComplete ? 'Built' : 'Build Knowledge'}</Button>
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-5">
            {buildStages.map((stage) => {
              const state = stageState(stage, phases, buildComplete);
              return (
                <div key={stage.key} className="rounded-lg border p-4" style={{ borderColor: state === 'done' ? 'var(--success)' : 'var(--border)', background: state === 'done' ? 'rgba(34,197,94,0.1)' : 'var(--bg-input)' }}>
                  <div className="text-sm font-medium">{stage.label}</div>
                  <div className="mt-2 text-xs" style={{ color: state === 'done' ? 'var(--success)' : 'var(--text-muted)' }}>{state === 'done' ? 'Completed' : building ? 'Waiting' : 'Ready'}</div>
                </div>
              );
            })}
          </div>
          {buildError && <p className="mt-4 text-sm" style={{ color: 'var(--danger)' }}>{buildError}</p>}
        </Card>
      )}

      {step === 3 && (
        <Card className="rounded-lg text-center">
          <Badge variant="success">Ready</Badge>
          <h2 className="mt-4 text-2xl font-semibold">Your AI Employee is Ready!</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: 'var(--text-muted)' }}>We have successfully learned your website and your AI is ready to answer visitors.</p>
          <Button className="mt-6" onClick={() => setStep(4)}>Continue Setup</Button>
        </Card>
      )}

      {step === 4 && (
        <Card className="rounded-lg">
          <h2 className="text-xl font-semibold">AI Behavior Instructions</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Configure how the AI assistant behaves on your website.</p>
          <div className="mt-6 space-y-4">
            {instructionTextFields.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--text)' }}>{label}</label>
                <textarea
                  className="min-h-20 w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                  style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }}
                  value={instructionForm[key]}
                  onChange={(event) => setInstructionForm({ ...instructionForm, [key]: event.target.value })}
                  placeholder={placeholder}
                />
              </div>
            ))}

            <div className="flex flex-wrap gap-6 pt-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={alwaysBookDemo}
                  onChange={(event) => setAlwaysBookDemo(event.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Always suggest booking a demo
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={avoidDiscounts}
                  onChange={(event) => setAvoidDiscounts(event.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Avoid mentioning discounts
              </label>
            </div>
          </div>
          <p className="mt-5 text-sm" style={{ color: 'var(--text-muted)' }}>These instructions are optional and can be changed anytime.</p>
          <div className="mt-5 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => saveInstructions(true)} disabled={savingInstructions}>Skip</Button>
            <Button onClick={() => saveInstructions(false)} loading={savingInstructions}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 5 && (
        <Card className="rounded-lg">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Review Website Actions</h2>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Review discovered intents and adjust preferred URLs using the existing Website Actions system.</p>
            </div>
            <Badge variant="neutral">{actionsPayload?.summary?.discoveredActions ?? 0} actions</Badge>
          </div>
          {actionsLoading ? <div className="mt-8 flex items-center gap-2 text-sm"><Spinner className="h-4 w-4" /> Loading actions</div> : (
            <div className="mt-6 space-y-3">
              {(actionsPayload?.actions ?? []).length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No Website Actions were discovered yet. You can continue and review them later.</p>}
              {(actionsPayload?.actions ?? []).slice(0, 12).map((action) => (
                <div key={action.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1.4fr_1.4fr_auto] md:items-center" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
                  <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Intent</div><div className="font-medium">{intentLabel(action.intent)}</div></div>
                  <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Resolved URL</div><div className="break-all text-sm">{action.automaticDestinationUrl}</div></div>
                  <div><div className="text-xs" style={{ color: 'var(--text-muted)' }}>Preferred URL</div><div className="break-all text-sm">{action.destinationUrl}</div></div>
                  <Button variant="secondary" size="sm" onClick={() => openActionEditor(action)}>Edit</Button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-6 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(4)}>Back</Button>
            <Button onClick={() => setStep(6)}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 6 && (
        <Card className="rounded-lg">
          <h2 className="text-xl font-semibold">Test Your AI</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Talk to your AI before installing the widget.</p>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
            <div className="rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="h-96 space-y-3 overflow-y-auto p-4">
                {chatMessages.length === 0 && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Ask a question to verify tone, accuracy, and next actions.</p>}
                {chatMessages.map((message, index) => (
                  <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[78%] rounded-lg px-4 py-3 text-sm" style={{ background: message.role === 'user' ? 'var(--accent)' : 'var(--bg-input)', color: 'var(--text)' }}>{message.content}</div>
                  </div>
                ))}
                {chatLoading && <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}><Spinner className="h-4 w-4" /> Thinking</div>}
              </div>
              <div className="flex gap-2 border-t p-3" style={{ borderColor: 'var(--border)' }}>
                <input className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: 'var(--bg-input)', borderColor: 'var(--border)', color: 'var(--text)' }} value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void sendChat(); }} placeholder="Ask your AI a question" />
                <Button onClick={() => sendChat()} loading={chatLoading}>Send</Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-sm font-medium">Suggested questions</div>
              {suggestedQuestions.map((question) => <button key={question} className="w-full rounded-lg border px-3 py-2 text-left text-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text)' }} onClick={() => sendChat(question)}>{question}</button>)}
            </div>
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(5)}>Back</Button>
            <Button onClick={() => setStep(7)}>Continue</Button>
          </div>
        </Card>
      )}

      {step === 7 && (
        <Card className="rounded-lg">
          <h2 className="text-xl font-semibold">Install Widget</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>Choose your platform, copy the code, and verify the installation.</p>
          <div className="mt-6 grid gap-2 md:grid-cols-4">
            {platforms.map((item) => <button key={item.id} className="rounded-lg border px-3 py-3 text-sm" style={{ borderColor: platform === item.id ? 'var(--accent)' : 'var(--border)', background: platform === item.id ? 'rgba(24,69,59,0.10)' : 'var(--bg-input)', color: 'var(--text)' }} onClick={() => setPlatform(item.id)}>{item.label}</button>)}
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-input)' }}>
              <h3 className="font-semibold">{platforms.find((item) => item.id === platform)?.label} instructions</h3>
              <ol className="mt-4 space-y-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                {platformGuides[platform].map((item, index) => <li key={item}><span className="mr-2 font-semibold" style={{ color: 'var(--text)' }}>{index + 1}.</span>{item}</li>)}
              </ol>
            </div>
            <div className="rounded-lg border p-5" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold">Widget code</h3>
                <Button variant="secondary" size="sm" onClick={copySnippet}>{copied ? 'Copied' : 'Copy Widget Code'}</Button>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-lg border p-4 text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>{snippet}</pre>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button onClick={verifyInstall} loading={verifyState === 'checking'}>Verify Installation</Button>
                {verifyState === 'installed' && <span className="text-sm" style={{ color: 'var(--success)' }}>Widget Installed Successfully</span>}
                {verifyState === 'missing' && <span className="text-sm" style={{ color: 'var(--danger)' }}>Widget Not Found</span>}
              </div>
              {verifyMessage && <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>{verifyMessage}</p>}
            </div>
          </div>
          <div className="mt-6 flex justify-between">
            <Button variant="secondary" onClick={() => setStep(6)}>Back</Button>
            <Button variant="ghost" onClick={() => setStep(8)}>Finish later</Button>
          </div>
        </Card>
      )}

      {step === 8 && (
        <Card className="rounded-lg text-center">
          <Badge variant="success">Live</Badge>
          <h2 className="mt-4 text-2xl font-semibold">Congratulations!</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: 'var(--text-muted)' }}>Your AI Employee is now live.</p>
          <div className="mt-8 grid gap-3 md:grid-cols-4">
            <Button variant="secondary" onClick={() => router.push('/analytics')}>View Analytics</Button>
            <Button variant="secondary" onClick={() => router.push('/conversations')}>Open Conversations</Button>
            <Button variant="secondary" onClick={() => router.push('/leads')}>Manage Leads</Button>
            <Button onClick={() => router.push('/websites')}>Go to Dashboard</Button>
          </div>
        </Card>
      )}

      {editingAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEditingAction(null)}>
          <div className="w-full max-w-xl rounded-lg border p-5" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }} onClick={(event) => event.stopPropagation()}>
            <h2 className="text-lg font-semibold">Edit Preferred URL</h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>{intentLabel(editingAction.intent)}</p>
            <div className="mt-4 space-y-2">
              {editingAction.details.selectableUrls.map((candidate) => (
                <label key={candidate} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm" style={{ borderColor: selectedUrl === candidate ? 'var(--accent)' : 'var(--border)' }}>
                  <input type="radio" checked={selectedUrl === candidate} onChange={() => setSelectedUrl(candidate)} />
                  <span className="break-all">{candidate}</span>
                </label>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingAction(null)}>Cancel</Button>
              <Button onClick={saveActionUrl} loading={savingAction}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}











