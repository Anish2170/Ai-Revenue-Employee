'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Card, Spinner, EmptyState } from '@/components/ui';

interface Summary {
  today: {
    visitors: number;
    conversations: number;
    popupCtr: number;
    popupDisplayed: number;
    popupClicked: number;
    chatOpens: number;
    messages: number;
    aiResponses: number;
    conversationsEndedWithoutEngagement: number;
  };
  topPages: Array<{ pagePath: string; pageTitle: string | null; conversations: number; events: number }>;
  topPopupTypes: Array<{ popupType: string; displayed: number; clicked: number; ctr: number }>;
  deviceBreakdown: Array<{ device: string; sessions: number }>;
  websitePerformance: Array<{ websiteId: string; name: string; url: string; visitors: number; conversations: number; popupClicks: number }>;
}

interface ChartResponse {
  metric: string;
  days: number;
  data: Array<{ date: string; value: number; displayed?: number; clicked?: number; messages?: number }>;
}

interface AiDecisionLog {
  id: string;
  occurredAt: string;
  websiteId: string;
  website: { name: string; url: string };
  sessionId: string;
  visitorId: string | null;
  pageUrl: string | null;
  pagePath: string | null;
  pageTitle: string | null;
  behaviorSummary: string | null;
  behaviorDominant: string | null;
  intentSummary: string | null;
  intentGoal: string | null;
  intentReadiness: string | null;
  salesStrategy: string | null;
  confidenceScore: number | null;
  confidenceBand: string | null;
  speakScore: number | null;
  decision: string;
  reason: string | null;
  popupGenerated: boolean;
  popupSuppressed: boolean;
  suppressionReason: string | null;
  generatedPopupType: string | null;
  generatedPopupTitle: string | null;
  ctaType: string | null;
  ctaText: string | null;
  llmUsed: boolean;
  validationPassed: boolean;
  finalOutcome: string;
  popupDisplayed: boolean;
  popupClicked: boolean;
  popupDismissed: boolean;
  chatOpened: boolean;
}

interface DecisionLogResponse {
  logs: AiDecisionLog[];
}

const emptySummary: Summary = {
  today: {
    visitors: 0,
    conversations: 0,
    popupCtr: 0,
    popupDisplayed: 0,
    popupClicked: 0,
    chatOpens: 0,
    messages: 0,
    aiResponses: 0,
    conversationsEndedWithoutEngagement: 0,
  },
  topPages: [],
  topPopupTypes: [],
  deviceBreakdown: [],
  websitePerformance: [],
};

function formatPct(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatConfidence(value: number | null) {
  return value == null ? '-' : `${Math.round(value * 100)}%`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function todayInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function maxChartValue(chart?: ChartResponse) {
  return Math.max(1, ...(chart?.data.map((point) => point.value) ?? [0]));
}

export function AnalyticsView({ websiteId, websiteName }: { websiteId?: string; websiteName?: string }) {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [visitorsChart, setVisitorsChart] = useState<ChartResponse | null>(null);
  const [chatsChart, setChatsChart] = useState<ChartResponse | null>(null);
  const [logs, setLogs] = useState<AiDecisionLog[]>([]);
  const [decisionFilter, setDecisionFilter] = useState('');
  const [popupTypeFilter, setPopupTypeFilter] = useState('');
  const [sessionFilter, setSessionFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [exportStartDate, setExportStartDate] = useState(todayInputValue());
  const [exportEndDate, setExportEndDate] = useState(todayInputValue());
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [loading, setLoading] = useState(true);
  const [logLoading, setLogLoading] = useState(true);
  const [error, setError] = useState('');
  const [logError, setLogError] = useState('');
  const scoped = Boolean(websiteId);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    Promise.all([
      api.getAnalyticsSummary(websiteId),
      api.getAnalyticsChart('daily_visitors', 14, websiteId),
      api.getAnalyticsChart('daily_chats', 14, websiteId),
    ])
      .then(([summaryData, visitorData, chatData]) => {
        if (!alive) return;
        setSummary(summaryData as Summary);
        setVisitorsChart(visitorData as ChartResponse);
        setChatsChart(chatData as ChartResponse);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Unable to load analytics');
        setSummary(emptySummary);
        setVisitorsChart(null);
        setChatsChart(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [websiteId]);

  useEffect(() => {
    let alive = true;
    setLogLoading(true);
    setLogError('');
    api.getAiDecisionLog({
      websiteId,
      decision: decisionFilter || undefined,
      popupType: popupTypeFilter || undefined,
      sessionId: sessionFilter || undefined,
      date: dateFilter || undefined,
      search: searchFilter || undefined,
      limit: 50,
    })
      .then((data) => {
        if (!alive) return;
        setLogs((data as DecisionLogResponse).logs);
      })
      .catch((err) => {
        if (!alive) return;
        setLogError(err instanceof Error ? err.message : 'Unable to load AI decision log');
        setLogs([]);
      })
      .finally(() => {
        if (alive) setLogLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [websiteId, decisionFilter, popupTypeFilter, sessionFilter, dateFilter, searchFilter]);

  const metrics = useMemo(() => [
    { label: "Today's Visitors", value: summary.today.visitors.toLocaleString() },
    { label: "Today's Conversations", value: summary.today.conversations.toLocaleString() },
    { label: "Today's Popup CTR", value: formatPct(summary.today.popupCtr), detail: `${summary.today.popupClicked}/${summary.today.popupDisplayed} clicks` },
    { label: "Today's Chat Opens", value: summary.today.chatOpens.toLocaleString() },
    { label: 'Messages', value: summary.today.messages.toLocaleString() },
    { label: 'AI Responses', value: summary.today.aiResponses.toLocaleString() },
  ], [summary]);

  const popupTypeOptions = useMemo(() => {
    const fromSummary = summary.topPopupTypes.map((popup) => popup.popupType);
    const fromLogs = logs.map((log) => log.generatedPopupType).filter((value): value is string => Boolean(value));
    return Array.from(new Set([...fromSummary, ...fromLogs])).sort();
  }, [logs, summary.topPopupTypes]);

  async function handleDownloadDecisionLog() {
    setExportError('');
    if (!exportStartDate || !exportEndDate) {
      setExportError('Select a start and end date.');
      return;
    }
    if (exportStartDate > exportEndDate) {
      setExportError('Start date must be before end date.');
      return;
    }

    setExporting(true);
    try {
      const data = await api.getAiDecisionLog({
        websiteId,
        startDate: exportStartDate,
        endDate: exportEndDate,
        limit: 5000,
        export: true,
      });
      const exportLogs = (data as DecisionLogResponse).logs;
      const content = buildDecisionLogExport(exportLogs, {
        websiteName,
        startDate: exportStartDate,
        endDate: exportEndDate,
        decision: '',
        popupType: '',
        sessionId: '',
        search: '',
      });
      downloadTextFile(decisionLogExportFilename(websiteName, exportStartDate, exportEndDate), content);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Unable to download AI decision log');
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="mt-1 text-[var(--text-muted)]">
          {scoped
            ? `Visitor, popup, chat, and knowledge performance for ${websiteName || 'this website'}.`
            : 'Visitor, popup, chat, and knowledge performance across your websites.'}
        </p>
      </div>

      {error && <div className="rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <Card key={metric.label} className="rounded-lg">
            <div className="text-sm text-[var(--text-muted)]">{metric.label}</div>
            <div className="mt-2 text-3xl font-semibold">{metric.value}</div>
            {metric.detail && <div className="mt-2 text-xs text-[var(--text-muted)]">{metric.detail}</div>}
          </Card>
        ))}
      </div>

      <DecisionLogCard
        logs={logs}
        loading={logLoading}
        error={logError}
        popupTypeOptions={popupTypeOptions}
        decisionFilter={decisionFilter}
        popupTypeFilter={popupTypeFilter}
        sessionFilter={sessionFilter}
        dateFilter={dateFilter}
        searchFilter={searchFilter}
        exportStartDate={exportStartDate}
        exportEndDate={exportEndDate}
        exporting={exporting}
        exportError={exportError}
        onExportStartDateChange={setExportStartDate}
        onExportEndDateChange={setExportEndDate}
        onDownload={handleDownloadDecisionLog}
        onDecisionChange={setDecisionFilter}
        onPopupTypeChange={setPopupTypeFilter}
        onSessionChange={setSessionFilter}
        onDateChange={setDateFilter}
        onSearchChange={setSearchFilter}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendCard title="Daily Visitors" chart={visitorsChart} />
        <TrendCard title="Daily Chats" chart={chatsChart} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-lg xl:col-span-2">
          <PanelHeader title="Top Pages" caption="Pages generating the most conversations today" />
          {summary.topPages.length === 0 ? (
            <EmptyState title="No page conversations yet" description="Conversation activity will appear here as visitors chat." />
          ) : (
            <div className="mt-4 divide-y divide-[var(--border)]">
              {summary.topPages.map((page) => (
                <div key={page.pagePath} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{page.pageTitle || page.pagePath}</div>
                    <div className="truncate text-sm text-[var(--text-muted)]">{page.pagePath}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold">{page.conversations}</div>
                    <div className="text-xs text-[var(--text-muted)]">conversations</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="rounded-lg">
          <PanelHeader title="Device Breakdown" caption="Sessions started today" />
          {summary.deviceBreakdown.length === 0 ? (
            <EmptyState title="No devices yet" />
          ) : (
            <div className="mt-4 space-y-3">
              {summary.deviceBreakdown.map((row) => (
                <BarRow key={row.device} label={row.device} value={row.sessions} max={Math.max(...summary.deviceBreakdown.map((d) => d.sessions), 1)} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-lg">
          <PanelHeader title="Top Popup Types" caption="Highest click-through rate today" />
          {summary.topPopupTypes.length === 0 ? (
            <EmptyState title="No popup activity yet" />
          ) : (
            <div className="mt-4 divide-y divide-[var(--border)]">
              {summary.topPopupTypes.map((popup) => (
                <div key={popup.popupType} className="grid grid-cols-4 items-center gap-3 py-3 text-sm">
                  <div className="col-span-2 font-medium">{popup.popupType}</div>
                  <div className="text-[var(--text-muted)]">{popup.clicked}/{popup.displayed}</div>
                  <div className="text-right font-semibold">{formatPct(popup.ctr)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {!scoped && (
          <Card className="rounded-lg">
            <PanelHeader title="Website Performance" caption="Best-performing websites today" />
            {summary.websitePerformance.length === 0 ? (
              <EmptyState title="No website activity yet" />
            ) : (
              <div className="mt-4 divide-y divide-[var(--border)]">
                {summary.websitePerformance.map((site) => (
                  <div key={site.websiteId} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{site.name}</div>
                      <div className="truncate text-sm text-[var(--text-muted)]">{site.url}</div>
                    </div>
                    <div className="shrink-0 text-right text-sm">
                      <div>{site.conversations} conversations</div>
                      <div className="text-xs text-[var(--text-muted)]">{site.visitors} visitors</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <Card className="rounded-lg">
        <div className="flex items-center justify-between gap-4">
          <PanelHeader title="Ended Without Engagement" caption="Sessions ended today without popup click, chat, message, or source click" />
          <div className="text-3xl font-semibold">{summary.today.conversationsEndedWithoutEngagement}</div>
        </div>
      </Card>
    </div>
  );
}

interface DecisionLogExportMeta {
  websiteName?: string;
  startDate: string;
  endDate: string;
  decision: string;
  popupType: string;
  sessionId: string;
  search: string;
}

function buildDecisionLogExport(logs: AiDecisionLog[], meta: DecisionLogExportMeta) {
  const dash = '-';
  const filters = [
    meta.decision ? `Decision: ${meta.decision}` : '',
    meta.popupType ? `Popup Type: ${meta.popupType}` : '',
    meta.sessionId ? `Session: ${meta.sessionId}` : '',
    meta.search ? `Session Search: ${meta.search}` : '',
  ].filter(Boolean);

  const sections = logs.map((log, index) => {
    const lines = [
      `#${index + 1} - ${formatExportDateTime(log.occurredAt)}`,
      `Website: ${log.website.name} (${log.website.url})`,
      `Session ID: ${log.sessionId}`,
      `Visitor ID: ${log.visitorId || dash}`,
      `Page Title: ${log.pageTitle || dash}`,
      `Page Path: ${log.pagePath || dash}`,
      `Page URL: ${log.pageUrl || dash}`,
      '',
      `Behavior Summary: ${log.behaviorSummary || dash}`,
      `Behavior Dominant: ${log.behaviorDominant || dash}`,
      `Intent Summary: ${log.intentSummary || dash}`,
      `Intent Goal: ${log.intentGoal || dash}`,
      `Intent Readiness: ${log.intentReadiness || dash}`,
      `Sales Strategy: ${log.salesStrategy || dash}`,
      `Confidence Score: ${formatConfidence(log.confidenceScore)}${log.confidenceBand ? ` (${log.confidenceBand})` : ''}`,
      `Speak Score: ${log.speakScore == null ? dash : log.speakScore}`,
      '',
      `Decision: ${log.decision}`,
      `Reason: ${log.reason || dash}`,
      `Popup Generated: ${yesNo(log.popupGenerated)}`,
      `Popup Suppressed: ${yesNo(log.popupSuppressed)}`,
      `Suppression Reason: ${log.suppressionReason || dash}`,
      `Generated Popup Type: ${log.generatedPopupType || dash}`,
      `Generated Popup Title: ${log.generatedPopupTitle || dash}`,
      `CTA Type: ${log.ctaType || dash}`,
      `CTA Text: ${log.ctaText || dash}`,
      `LLM Used: ${yesNo(log.llmUsed)}`,
      `Validation Passed: ${yesNo(log.validationPassed)}`,
      '',
      `Final Outcome: ${log.finalOutcome}`,
      `Popup Displayed: ${yesNo(log.popupDisplayed)}`,
      `Popup Clicked: ${yesNo(log.popupClicked)}`,
      `Popup Dismissed: ${yesNo(log.popupDismissed)}`,
      `Chat Opened: ${yesNo(log.chatOpened)}`,
    ];
    return lines.join('\r\n');
  });

  return [
    'AI Decision Log Export',
    `Generated At: ${formatExportDateTime(new Date().toISOString())}`,
    `Website: ${meta.websiteName || 'All websites'}`,
    `Date Range: ${meta.startDate} to ${meta.endDate}`,
    `Filters: ${filters.length ? filters.join(', ') : 'None'}`,
    `Total Decisions: ${logs.length}`,
    '',
    sections.length ? sections.join('\r\n\r\n' + '='.repeat(72) + '\r\n\r\n') : 'No AI decision logs found for this range.',
    '',
  ].join('\r\n');
}

function formatExportDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function yesNo(value: boolean) {
  return value ? 'Yes' : 'No';
}

function decisionLogExportFilename(websiteName: string | undefined, startDate: string, endDate: string) {
  const scope = (websiteName || 'all-websites').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `ai-decision-log-${scope}-${startDate}-to-${endDate}.txt`;
}

function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
function DecisionLogCard({
  logs,
  loading,
  error,
  popupTypeOptions,
  decisionFilter,
  popupTypeFilter,
  sessionFilter,
  dateFilter,
  searchFilter,
  exportStartDate,
  exportEndDate,
  exporting,
  exportError,
  onExportStartDateChange,
  onExportEndDateChange,
  onDownload,
  onDecisionChange,
  onPopupTypeChange,
  onSessionChange,
  onDateChange,
  onSearchChange,
}: {
  logs: AiDecisionLog[];
  loading: boolean;
  error: string;
  popupTypeOptions: string[];
  decisionFilter: string;
  popupTypeFilter: string;
  sessionFilter: string;
  dateFilter: string;
  searchFilter: string;
  exportStartDate: string;
  exportEndDate: string;
  exporting: boolean;
  exportError: string;
  onExportStartDateChange: (value: string) => void;
  onExportEndDateChange: (value: string) => void;
  onDownload: () => void;
  onDecisionChange: (value: string) => void;
  onPopupTypeChange: (value: string) => void;
  onSessionChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onSearchChange: (value: string) => void;
}) {
  return (
    <Card className="rounded-lg">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <PanelHeader title="AI Decision Log" caption="Newest popup decisions first, from behavior through widget outcome" />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <select className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" value={decisionFilter} onChange={(e) => onDecisionChange(e.target.value)}>
            <option value="">All decisions</option>
            <option value="Popup Generated">Popup Generated</option>
            <option value="Suppressed">Suppressed</option>
          </select>
          <select className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" value={popupTypeFilter} onChange={(e) => onPopupTypeChange(e.target.value)}>
            <option value="">All popup types</option>
            {popupTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" placeholder="Session exact" value={sessionFilter} onChange={(e) => onSessionChange(e.target.value)} />
          <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" type="date" value={dateFilter} max={todayInputValue()} onChange={(e) => onDateChange(e.target.value)} />
          <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" placeholder="Search session" value={searchFilter} onChange={(e) => onSearchChange(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-[var(--text-muted)]">
              From
              <input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]" type="date" value={exportStartDate} max={todayInputValue()} onChange={(e) => onExportStartDateChange(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-[var(--text-muted)]">
              To
              <input className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]" type="date" value={exportEndDate} max={todayInputValue()} onChange={(e) => onExportEndDateChange(e.target.value)} />
            </label>
          </div>
          <button
            type="button"
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={exporting}
            onClick={onDownload}
          >
            {exporting ? 'Preparing...' : 'Download Log'}
          </button>
        </div>
        {exportError && <div className="mt-3 text-sm text-[var(--danger)]">{exportError}</div>}
      </div>

      {error && <div className="mt-4 rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
      {loading ? (
        <div className="flex h-32 items-center justify-center"><Spinner /></div>
      ) : logs.length === 0 ? (
        <EmptyState title="No AI decisions yet" description="Popup decisions will appear as visitors browse and the Sales Brain evaluates sessions." />
      ) : (
        <div className="mt-4 divide-y divide-[var(--border)]">
          {logs.map((log) => <DecisionLogRow key={log.id} log={log} />)}
        </div>
      )}
    </Card>
  );
}

function DecisionLogRow({ log }: { log: AiDecisionLog }) {
  const decisionColor = log.decision === 'Popup Generated' ? 'text-[var(--success)]' : 'text-[var(--warning)]';
  return (
    <div className="grid gap-4 py-4 xl:grid-cols-[160px_1fr_220px]">
      <div className="space-y-1 text-sm">
        <div className="font-semibold">{formatTime(log.occurredAt)}</div>
        <div className="truncate text-[var(--text-muted)]">{log.website.name}</div>
        <div className="truncate font-mono text-xs text-[var(--text-muted)]">{log.sessionId}</div>
        <div className="truncate text-xs text-[var(--text-muted)]">{log.pageTitle || log.pagePath || 'Unknown page'}</div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DecisionFact label="Behavior" value={log.behaviorSummary || log.behaviorDominant || '-'} />
        <DecisionFact label="Intent" value={log.intentSummary || [log.intentGoal, log.intentReadiness].filter(Boolean).join(' / ') || '-'} />
        <DecisionFact label="Strategy" value={log.salesStrategy || '-'} />
        <DecisionFact label="Confidence" value={`${formatConfidence(log.confidenceScore)}${log.confidenceBand ? ` (${log.confidenceBand})` : ''}`} />
        <DecisionFact label="Decision" value={log.decision} valueClassName={decisionColor} />
        <DecisionFact label="Reason" value={log.suppressionReason || log.reason || '-'} />
        <DecisionFact label="Popup" value={log.generatedPopupTitle || log.generatedPopupType || '-'} />
        <DecisionFact label="CTA" value={[log.ctaText, log.ctaType].filter(Boolean).join(' / ') || '-'} />
      </div>
      <div className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <StatusPill label="LLM" active={log.llmUsed} />
          <StatusPill label="Validation" active={log.validationPassed} />
          <StatusPill label="Generated" active={log.popupGenerated} />
          <StatusPill label="Suppressed" active={log.popupSuppressed} />
          <StatusPill label="Displayed" active={log.popupDisplayed} />
          <StatusPill label="Clicked" active={log.popupClicked} />
          <StatusPill label="Dismissed" active={log.popupDismissed} />
          <StatusPill label="Chat" active={log.chatOpened} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-xs">
          <div className="text-[var(--text-muted)]">Final Outcome</div>
          <div className="font-semibold">{log.finalOutcome}</div>
        </div>
      </div>
    </div>
  );
}

function DecisionFact({ label, value, valueClassName = '' }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm">
      <div className="text-xs text-[var(--text-muted)]">{label}</div>
      <div className={`mt-1 truncate font-medium ${valueClassName}`}>{value}</div>
    </div>
  );
}

function StatusPill({ label, active }: { label: string; active: boolean }) {
  return (
    <div className={`rounded-full px-2.5 py-1 text-center text-xs ${active ? 'bg-[rgba(34,197,94,0.15)] text-[var(--success)]' : 'bg-[var(--bg-input)] text-[var(--text-muted)]'}`}>
      {label}
    </div>
  );
}

function PanelHeader({ title, caption }: { title: string; caption: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{caption}</p>
    </div>
  );
}

function TrendCard({ title, chart }: { title: string; chart: ChartResponse | null }) {
  const max = maxChartValue(chart ?? undefined);
  return (
    <Card className="rounded-lg">
      <PanelHeader title={title} caption="Last 14 days" />
      <div className="mt-5 flex h-36 items-end gap-2">
        {(chart?.data ?? []).map((point) => (
          <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div
              className="w-full rounded-t bg-[var(--accent)] opacity-80"
              style={{ height: `${Math.max(6, (point.value / max) * 112)}px` }}
              title={`${point.date}: ${point.value}`}
            />
            <div className="w-full truncate text-center text-[10px] text-[var(--text-muted)]">{point.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span>{label}</span>
        <span className="text-[var(--text-muted)]">{value}</span>
      </div>
      <div className="h-2 rounded bg-[var(--bg-input)]">
        <div className="h-2 rounded bg-[var(--accent)]" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
      </div>
    </div>
  );
}
