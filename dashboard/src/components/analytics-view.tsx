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
  ctaActionId: string | null;
  expectedAction: boolean;
  primaryActionReturned: string | null;
  fallbackApplied: boolean;
  fallbackUsed: string | null;
  missingActionReason: string | null;
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

type WebsiteOption = { id: string; name: string; url: string };
type DateRangeKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'custom';

type RangeConfig = {
  key: DateRangeKey;
  label: string;
  kpiPrefix: string;
  chartDays: number;
  currentDays: number;
  compareDays: number;
  canCompare: boolean;
  chartCaption: string;
  startDate?: string;
  endDate?: string;
};

type TrendResult = {
  direction: 'up' | 'down' | 'flat';
  label: string;
};

type KpiMetric = {
  label: string;
  value: string;
  detail?: string;
  trend?: TrendResult;
};

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  scorePercent: number;
  scoreLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  status: string;
  capturedAt: string;
  website: { id: string; name: string; url: string };
  conversation: { id: string; title: string };
};

type ConversationRow = {
  id: string;
  title: string;
  status: string;
  totalMessages: number;
  messageCount?: number;
  startedAt: string;
  lastMessageAt: string;
};

type ActivityRow = {
  id: string;
  type: string;
  title: string;
  detail: string;
  occurredAt: string;
};
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


export function AnalyticsView({ websiteId, websiteName }: { websiteId?: string; websiteName?: string }) {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [visitorsChart, setVisitorsChart] = useState<ChartResponse | null>(null);
  const [chatsChart, setChatsChart] = useState<ChartResponse | null>(null);
  const [websites, setWebsites] = useState<WebsiteOption[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [selectedWebsiteId, setSelectedWebsiteId] = useState(websiteId || '');
  const [dateRange, setDateRange] = useState<DateRangeKey>('today');
  const [customStartDate, setCustomStartDate] = useState(todayInputValue());
  const [customEndDate, setCustomEndDate] = useState(todayInputValue());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scoped = Boolean(websiteId);

  useEffect(() => {
    if (!websiteId) return;
    void Promise.resolve().then(() => setSelectedWebsiteId(websiteId));
  }, [websiteId]);

  const activeWebsiteId = scoped ? websiteId : selectedWebsiteId || undefined;
  const rangeConfig = useMemo(() => getRangeConfig(dateRange, customStartDate, customEndDate), [dateRange, customStartDate, customEndDate]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setLoading(true);
      setError('');
    });

    const requests: Promise<unknown>[] = [
      api.getAnalyticsSummary(activeWebsiteId),
      api.getAnalyticsChart('daily_visitors', rangeConfig.chartDays, activeWebsiteId),
      api.getAnalyticsChart('daily_chats', rangeConfig.chartDays, activeWebsiteId),
      api.listLeads(activeWebsiteId),
      api.listConversations(activeWebsiteId),
    ];

    if (!scoped) requests.push(api.listWebsites());

    void Promise.all(requests)
      .then(([summaryData, visitorData, chatData, leadData, conversationData, websiteData]) => {
        if (!alive) return;
        setSummary(summaryData as Summary);
        setVisitorsChart(visitorData as ChartResponse);
        setChatsChart(chatData as ChartResponse);
        setLeads(leadData as LeadRow[]);
        setConversations(conversationData as ConversationRow[]);
        if (!scoped) setWebsites((websiteData as WebsiteOption[]) ?? []);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Unable to load analytics');
        setSummary(emptySummary);
        setVisitorsChart(null);
        setChatsChart(null);
        setLeads([]);
        setConversations([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [activeWebsiteId, rangeConfig.chartDays, scoped]);

  const filteredLeads = useMemo(() => filterByDate(leads, 'capturedAt', rangeConfig), [leads, rangeConfig]);
  const filteredConversations = useMemo(() => filterByDate(conversations, 'startedAt', rangeConfig), [conversations, rangeConfig]);
  const visitorSeries = useMemo(() => visitorsChart?.data ?? [], [visitorsChart]);
  const chatSeries = useMemo(() => chatsChart?.data ?? [], [chatsChart]);
  const visitorComparison = useMemo(() => compareSeries(visitorSeries, rangeConfig), [visitorSeries, rangeConfig]);
  const chatComparison = useMemo(() => compareSeries(chatSeries, rangeConfig), [chatSeries, rangeConfig]);
  const leadsComparison = useMemo(() => compareRowsByDate(leads, 'capturedAt', rangeConfig), [leads, rangeConfig]);
  const selectedWebsiteName = scoped ? websiteName : websites.find((site) => site.id === selectedWebsiteId)?.name;

  const isToday = dateRange === 'today';
  const displayedVisitors = isToday ? summary.today.visitors : visitorComparison.current;
  const displayedConversations = isToday ? summary.today.conversations : chatComparison.current;
  const displayedChatOpens = isToday ? summary.today.chatOpens : chatComparison.current;
  const metrics: KpiMetric[] = [
    { label: rangeConfig.kpiPrefix + ' Visitors', value: formatNumber(displayedVisitors), trend: visitorComparison.trend },
    { label: 'Unique Visitors', value: 'Unavailable', detail: 'Not exposed by analytics API yet' },
    { label: 'Returning Visitors', value: 'Unavailable', detail: 'Not exposed by analytics API yet' },
    { label: rangeConfig.kpiPrefix + ' Conversations', value: formatNumber(displayedConversations), trend: chatComparison.trend },
    { label: rangeConfig.kpiPrefix + ' Chat Opens', value: formatNumber(displayedChatOpens), trend: chatComparison.trend },
    { label: 'Messages', value: isToday ? formatNumber(summary.today.messages) : 'Unavailable' },
    { label: 'AI Responses', value: isToday ? formatNumber(summary.today.aiResponses) : 'Unavailable' },
    { label: 'Leads Captured', value: formatNumber(filteredLeads.length), trend: leadsComparison.trend },
    { label: 'Lead Conversion Rate', value: displayedVisitors > 0 ? formatPct(filteredLeads.length / displayedVisitors) : 'No Data Yet' },
    { label: 'Popup CTR', value: isToday ? formatPct(summary.today.popupCtr) : 'Unavailable', detail: isToday ? `${summary.today.popupClicked}/${summary.today.popupDisplayed} clicks` : undefined },
    { label: 'Website Action CTR', value: 'Unavailable', detail: 'No analytics endpoint exposes range action CTR yet' },
    { label: 'Email Capture Rate', value: 'Unavailable' },
    { label: 'Average Response Time', value: 'Unavailable' },
    { label: 'Average Conversation Length', value: averageMessages(filteredConversations) },
    { label: 'Escalated Conversations', value: 'Coming Soon' },
    { label: 'Resolved Without Human', value: 'Unavailable' },
  ];

  const recentActivity = useMemo(() => buildRecentActivity(filteredLeads, filteredConversations), [filteredLeads, filteredConversations]);
  const topPerformers = useMemo(() => buildTopPerformers(summary, filteredLeads), [summary, filteredLeads]);
  const leadStats = useMemo(() => getLeadStats(filteredLeads), [filteredLeads]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="mt-1 text-[var(--text-muted)]">
            {activeWebsiteId
              ? `Business performance for ${selectedWebsiteName || websiteName || 'this website'}.`
              : 'Business performance across your websites.'}
          </p>
        </div>
        <div className="text-sm text-[var(--text-muted)]">{rangeConfig.label}</div>
      </div>

      {error && <div className="rounded-lg border border-[var(--danger)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}

      <FilterBar
        scoped={scoped}
        websites={websites}
        selectedWebsiteId={selectedWebsiteId}
        dateRange={dateRange}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onWebsiteChange={setSelectedWebsiteId}
        onDateRangeChange={setDateRange}
        onCustomStartDateChange={setCustomStartDate}
        onCustomEndDateChange={setCustomEndDate}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => <KpiCard key={metric.label} metric={metric} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TrendCard title="Visitors over time" caption={rangeConfig.chartCaption} chart={visitorsChart} range={rangeConfig} />
        <TrendCard title="Conversations per day" caption={rangeConfig.chartCaption} chart={chatsChart} range={rangeConfig} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <TopPerformersCard items={topPerformers} />
        <RecentActivityCard activities={recentActivity} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="rounded-lg xl:col-span-2">
          <PanelHeader title="Visitor Analytics" caption="Pages generating business conversations" />
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
                    <div className="font-semibold">{formatNumber(page.conversations)}</div>
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
            <EmptyState title="No devices yet" description="Device data will appear after tracked visitor sessions." />
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
        <MetricGroup
          title="Conversation Analytics"
          caption="Business conversation quality indicators"
          rows={[
            ['Average messages', averageMessages(filteredConversations)],
            ['Average conversation duration', 'Unavailable'],
            ['Conversation completion rate', 'Unavailable'],
            ['Average AI response time', 'Unavailable'],
          ]}
        />
        <MetricGroup
          title="Lead Analytics"
          caption="Lead capture and score visibility"
          rows={[
            ['Total Leads', formatNumber(filteredLeads.length)],
            ['HIGH Intent', formatNumber(leadStats.high)],
            ['MEDIUM Intent', formatNumber(leadStats.medium)],
            ['LOW Intent', formatNumber(leadStats.low)],
            ['Lead conversion %', displayedVisitors > 0 ? formatPct(filteredLeads.length / displayedVisitors) : 'No Data Yet'],
            ['Lead capture %', displayedChatOpens > 0 ? formatPct(filteredLeads.length / displayedChatOpens) : 'No Data Yet'],
            ['Lead score distribution', leadStats.total > 0 ? `${leadStats.high} high / ${leadStats.medium} medium / ${leadStats.low} low` : 'No Data Yet'],
          ]}
        />
      </div>

      <SalesFunnel visitors={displayedVisitors} chats={displayedChatOpens} leads={filteredLeads.length} />

      <div className="grid gap-4 xl:grid-cols-2">
        <UnavailableCard title="Top Questions" caption="Most asked question grouping is coming soon once question analytics are available." />
        <Card className="rounded-lg">
          <PanelHeader title="Website Action Analytics" caption="Popup and CTA performance from existing analytics" />
          {summary.topPopupTypes.length === 0 ? (
            <EmptyState title="No popup activity yet" description="Popup uses, clicks, CTR, conversions, and CTA winners will appear here when available." />
          ) : (
            <div className="mt-4 divide-y divide-[var(--border)]">
              {summary.topPopupTypes.map((popup) => (
                <div key={popup.popupType} className="grid grid-cols-4 items-center gap-3 py-3 text-sm">
                  <div className="col-span-2 font-medium">{popup.popupType}</div>
                  <div className="text-[var(--text-muted)]">{formatNumber(popup.clicked)}/{formatNumber(popup.displayed)}</div>
                  <div className="text-right font-semibold">{formatPct(popup.ctr)}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <MetricGroup
          title="Knowledge Analytics"
          caption="Knowledge build health from existing status surfaces"
          rows={[
            ['Knowledge Build Status', 'Unavailable'],
            ['Knowledge Freshness', 'Unavailable'],
            ['Indexed Pages', 'Unavailable'],
            ['Chunks', 'Unavailable'],
            ['Embeddings', 'Unavailable'],
            ['Failed Pages', 'Unavailable'],
          ]}
        />
        <WebsitePerformanceCard rows={summary.websitePerformance} scoped={Boolean(activeWebsiteId)} />
      </div>

      <RecentLeadsCard leads={filteredLeads} />
    </div>
  );
}
export function AiDecisionLogView({ websiteId, websiteName }: { websiteId?: string; websiteName?: string }) {
  const [summary, setSummary] = useState<Summary>(emptySummary);
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
  const [logLoading, setLogLoading] = useState(true);
  const [logError, setLogError] = useState('');

  useEffect(() => {
    let alive = true;
    api.getAnalyticsSummary(websiteId)
      .then((data) => { if (alive) setSummary(data as Summary); })
      .catch(() => { if (alive) setSummary(emptySummary); });
    return () => { alive = false; };
  }, [websiteId]);

  useEffect(() => {
    let alive = true;
    void Promise.resolve().then(() => {
      if (!alive) return;
      setLogLoading(true);
      setLogError('');
    });
    void api.getAiDecisionLog({
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
    return () => { alive = false; };
  }, [websiteId, decisionFilter, popupTypeFilter, sessionFilter, dateFilter, searchFilter]);

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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">AI Decision Log</h1>
        <p className="mt-1 text-[var(--text-muted)]">Internal developer console for popup decisions, reasoning, validation, LLM usage, and widget outcomes.</p>
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
      `CTA Action ID: ${log.ctaActionId || dash}`,
      `Expected Action: ${yesNo(log.expectedAction)}`,
      `Primary Action Returned: ${log.primaryActionReturned || dash}`,
      `Fallback Applied: ${yesNo(log.fallbackApplied)}`,
      `Fallback Used: ${log.fallbackUsed || dash}`,
      `Missing Action Reason: ${log.missingActionReason || dash}`,
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
        <DecisionFact label="CTA" value={[log.ctaActionId, log.ctaText, log.ctaType].filter(Boolean).join(' / ') || '-'} />
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

function FilterBar({
  scoped,
  websites,
  selectedWebsiteId,
  dateRange,
  customStartDate,
  customEndDate,
  onWebsiteChange,
  onDateRangeChange,
  onCustomStartDateChange,
  onCustomEndDateChange,
}: {
  scoped: boolean;
  websites: WebsiteOption[];
  selectedWebsiteId: string;
  dateRange: DateRangeKey;
  customStartDate: string;
  customEndDate: string;
  onWebsiteChange: (value: string) => void;
  onDateRangeChange: (value: DateRangeKey) => void;
  onCustomStartDateChange: (value: string) => void;
  onCustomEndDateChange: (value: string) => void;
}) {
  const ranges: Array<{ key: DateRangeKey; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'last7', label: 'Last 7 Days' },
    { key: 'last30', label: 'Last 30 Days' },
    { key: 'last90', label: 'Last 90 Days' },
    { key: 'custom', label: 'Custom Range' },
  ];

  return (
    <Card className="rounded-lg p-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(220px,320px)_1fr] xl:items-end">
        <label className="flex flex-col gap-1 text-sm">
          Website
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm"
            value={selectedWebsiteId}
            disabled={scoped}
            onChange={(event) => onWebsiteChange(event.target.value)}
          >
            <option value="">All Websites</option>
            {websites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-end gap-2">
          {ranges.map((range) => (
            <button
              key={range.key}
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              style={{
                borderColor: dateRange === range.key ? 'var(--accent)' : 'var(--border)',
                background: dateRange === range.key ? 'rgba(24, 69, 59, 0.10)' : 'transparent',
                color: 'var(--text)',
              }}
              onClick={() => onDateRangeChange(range.key)}
            >
              {range.label}
            </button>
          ))}
          {dateRange === 'custom' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" type="date" value={customStartDate} max={todayInputValue()} onChange={(event) => onCustomStartDateChange(event.target.value)} />
              <input className="rounded-lg border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm" type="date" value={customEndDate} max={todayInputValue()} onChange={(event) => onCustomEndDateChange(event.target.value)} />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function KpiCard({ metric }: { metric: KpiMetric }) {
  return (
    <Card className="rounded-lg p-4">
      <div className="text-sm text-[var(--text-muted)]">{metric.label}</div>
      <div className="mt-2 min-h-8 text-2xl font-semibold">{metric.value}</div>
      {metric.trend && <TrendPill trend={metric.trend} />}
      {metric.detail && <div className="mt-2 text-xs text-[var(--text-muted)]">{metric.detail}</div>}
    </Card>
  );
}

function TrendPill({ trend }: { trend: TrendResult }) {
  const color = trend.direction === 'up' ? 'var(--success)' : trend.direction === 'down' ? 'var(--danger)' : 'var(--text-muted)';
  const label = trend.direction === 'up' ? 'Up' : trend.direction === 'down' ? 'Down' : 'No change';
  return <div className="mt-2 text-xs font-medium" style={{ color }}>{label} {trend.label}</div>;
}

function MetricGroup({ title, caption, rows }: { title: string; caption: string; rows: Array<[string, string]> }) {
  return (
    <Card className="rounded-lg">
      <PanelHeader title={title} caption={caption} />
      <div className="mt-4 divide-y divide-[var(--border)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
            <span className="text-[var(--text-muted)]">{label}</span>
            <span className="font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SalesFunnel({ visitors, chats, leads }: { visitors: number; chats: number; leads: number }) {
  const steps = [
    ['Visitors', formatNumber(visitors)],
    ['Chat Opened', formatNumber(chats)],
    ['Conversation Started', formatNumber(chats)],
    ['Meaningful Conversation', 'Coming Soon'],
    ['Lead Captured', formatNumber(leads)],
    ['Demo Requested', 'Coming Soon'],
    ['Converted', 'Coming Soon'],
  ];

  return (
    <Card className="rounded-lg">
      <PanelHeader title="Sales Funnel" caption="Visitor journey from first visit to conversion" />
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        {steps.map(([label, value], index) => (
          <div key={label} className="relative rounded-lg border border-[var(--border)] bg-[var(--bg-input)] p-3 text-center">
            <div className="text-sm font-semibold">{label}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">{value}</div>
            {index < steps.length - 1 && <div className="pointer-events-none absolute -right-2 top-1/2 hidden -translate-y-1/2 text-[var(--text-muted)] xl:block">&darr;</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

function TopPerformersCard({ items }: { items: Array<[string, string]> }) {
  return (
    <Card className="rounded-lg xl:col-span-1">
      <PanelHeader title="Top Performers" caption="Best performing business signals" />
      <div className="mt-4 divide-y divide-[var(--border)]">
        {items.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm">
            <span className="text-[var(--text-muted)]">{label}</span>
            <span className="max-w-[60%] truncate text-right font-semibold">{value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RecentActivityCard({ activities }: { activities: ActivityRow[] }) {
  return (
    <Card className="rounded-lg xl:col-span-2">
      <PanelHeader title="Recent Activity" caption="Newest business events from existing dashboard data" />
      {activities.length === 0 ? (
        <EmptyState title="No recent activity" description="Lead and conversation activity will appear here when available." />
      ) : (
        <div className="mt-4 divide-y divide-[var(--border)]">
          {activities.map((activity) => (
            <div key={activity.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[150px_1fr_auto] sm:items-center">
              <div className="font-medium">{activity.type}</div>
              <div className="min-w-0">
                <div className="truncate">{activity.title}</div>
                <div className="truncate text-xs text-[var(--text-muted)]">{activity.detail}</div>
              </div>
              <div className="text-xs text-[var(--text-muted)]">{formatDateTime(activity.occurredAt)}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WebsitePerformanceCard({ rows, scoped }: { rows: Summary['websitePerformance']; scoped: boolean }) {
  return (
    <Card className="rounded-lg">
      <PanelHeader title="Website Performance" caption={scoped ? 'Selected website performance today' : 'Best-performing websites today'} />
      {rows.length === 0 ? (
        <EmptyState title="No website activity yet" description="Website performance appears after visitor and conversation tracking." />
      ) : (
        <div className="mt-4 divide-y divide-[var(--border)]">
          {rows.map((site) => (
            <div key={site.websiteId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{site.name}</div>
                <div className="truncate text-sm text-[var(--text-muted)]">{site.url}</div>
              </div>
              <div className="shrink-0 text-right text-sm">
                <div>{formatNumber(site.conversations)} conversations</div>
                <div className="text-xs text-[var(--text-muted)]">{formatNumber(site.visitors)} visitors</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RecentLeadsCard({ leads }: { leads: LeadRow[] }) {
  return (
    <Card className="rounded-lg p-0 overflow-hidden">
      <div className="p-6 pb-3"><PanelHeader title="Recent Leads" caption="Latest captured contacts for the selected filters" /></div>
      {leads.length === 0 ? (
        <EmptyState title="No Data Yet" description="Captured leads will appear here when visitors share contact details." />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[920px] w-full text-left text-sm">
            <thead className="bg-[var(--bg-input)] text-[var(--text-muted)]">
              <tr>{['Name', 'Email', 'Phone', 'Lead Score', 'Website', 'Conversation', 'Status', 'Created'].map((heading) => <th key={heading} className="px-4 py-3 text-xs font-semibold uppercase">{heading}</th>)}</tr>
            </thead>
            <tbody>
              {leads.slice(0, 8).map((lead) => (
                <tr key={lead.id} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-4">{lead.name || 'Unavailable'}</td>
                  <td className="px-4 py-4">{lead.email || 'Unavailable'}</td>
                  <td className="px-4 py-4">{lead.phone || 'Unavailable'}</td>
                  <td className="px-4 py-4">{lead.scorePercent}% {lead.scoreLabel}</td>
                  <td className="px-4 py-4">{lead.website.name}</td>
                  <td className="px-4 py-4">{lead.conversation.title}</td>
                  <td className="px-4 py-4">{lead.status}</td>
                  <td className="px-4 py-4">{formatDateTime(lead.capturedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function UnavailableCard({ title, caption }: { title: string; caption: string }) {
  return (
    <Card className="rounded-lg">
      <PanelHeader title={title} caption={caption} />
      <EmptyState title="No Data Yet" description="This dashboard will show real data here when the existing analytics API exposes it." />
    </Card>
  );
}

function TrendCard({ title, caption, chart, range }: { title: string; caption: string; chart: ChartResponse | null; range: RangeConfig }) {
  const visibleData = useMemo(() => currentSeries(chart?.data ?? [], range), [chart, range]);
  const max = Math.max(1, ...visibleData.map((point) => point.value));
  return (
    <Card className="rounded-lg">
      <PanelHeader title={title} caption={caption} />
      {visibleData.length === 0 || visibleData.every((point) => point.value === 0) ? (
        <EmptyState title="No Data Yet" description="Activity will appear here once visitors are tracked." />
      ) : (
        <div className="mt-5 flex h-36 items-end gap-2 overflow-hidden">
          {visibleData.map((point) => (
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
      )}
    </Card>
  );
}
function getRangeConfig(key: DateRangeKey, customStartDate: string, customEndDate: string): RangeConfig {
  if (key === 'yesterday') return { key, label: 'Yesterday', kpiPrefix: 'Yesterday', chartDays: 2, currentDays: 1, compareDays: 1, canCompare: true, chartCaption: 'Yesterday compared with the day before' };
  if (key === 'last7') return { key, label: 'Last 7 Days', kpiPrefix: 'Last 7 Days', chartDays: 14, currentDays: 7, compareDays: 7, canCompare: true, chartCaption: 'Last 7 days compared with previous 7 days' };
  if (key === 'last30') return { key, label: 'Last 30 Days', kpiPrefix: 'Last 30 Days', chartDays: 60, currentDays: 30, compareDays: 30, canCompare: true, chartCaption: 'Last 30 days compared with previous 30 days' };
  if (key === 'last90') return { key, label: 'Last 90 Days', kpiPrefix: 'Last 90 Days', chartDays: 60, currentDays: 60, compareDays: 0, canCompare: false, chartCaption: 'Showing the latest 60 days available from the analytics API' };
  if (key === 'custom') {
    const days = Math.min(Math.max(daysBetween(customStartDate, customEndDate) + 1, 1), 60);
    return { key, label: `${customStartDate} to ${customEndDate}`, kpiPrefix: 'Selected Range', chartDays: days, currentDays: days, compareDays: 0, canCompare: false, chartCaption: 'Custom range from available analytics data', startDate: customStartDate, endDate: customEndDate };
  }
  return { key, label: 'Today', kpiPrefix: "Today's", chartDays: 2, currentDays: 1, compareDays: 1, canCompare: true, chartCaption: 'Today compared with yesterday' };
}

function daysBetween(start: string, end: string) {
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T00:00:00`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
  return Math.round((endMs - startMs) / 86_400_000);
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function currentSeries(data: ChartResponse['data'], range: RangeConfig) {
  if (range.key === 'yesterday') return data.slice(-2, -1);
  if (range.key === 'custom' && range.startDate && range.endDate) return data.filter((point) => point.date >= range.startDate! && point.date <= range.endDate!);
  return data.slice(-range.currentDays);
}

function compareSeries(data: ChartResponse['data'], range: RangeConfig): { current: number; previous: number | null; trend?: TrendResult } {
  const current = sumPoints(currentSeries(data, range));
  if (!range.canCompare || range.compareDays <= 0 || data.length < range.currentDays + range.compareDays) return { current, previous: null };
  const currentStart = range.key === 'yesterday' ? data.length - 2 : data.length - range.currentDays;
  const previous = sumPoints(data.slice(Math.max(0, currentStart - range.compareDays), currentStart));
  return { current, previous, trend: buildTrend(current, previous) };
}

function sumPoints(points: ChartResponse['data']) {
  return points.reduce((total, point) => total + safeNumber(point.value), 0);
}

function safeNumber(value: number) {
  return Number.isFinite(value) ? value : 0;
}

function buildTrend(current: number, previous: number): TrendResult | undefined {
  if (!Number.isFinite(previous) || previous < 0) return undefined;
  if (previous === 0 && current === 0) return { direction: 'flat', label: 'No change' };
  if (previous === 0) return undefined;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { direction: 'flat', label: 'No change' };
  return { direction: change > 0 ? 'up' : 'down', label: `${Math.round(Math.abs(change))}%` };
}

function filterByDate<T extends Record<string, unknown>>(rows: T[], field: keyof T, range: RangeConfig) {
  if (range.key === 'last90') return rows;
  const today = todayInputValue();
  const end = range.key === 'yesterday' ? offsetDate(today, -1) : range.endDate ?? today;
  const start = range.key === 'today'
    ? today
    : range.key === 'yesterday'
      ? end
      : range.key === 'last7'
        ? offsetDate(today, -6)
        : range.key === 'last30'
          ? offsetDate(today, -29)
          : range.startDate ?? today;
  return rows.filter((row) => {
    const raw = row[field];
    if (typeof raw !== 'string') return false;
    const key = raw.slice(0, 10);
    return key >= start && key <= end;
  });
}

function offsetDate(value: string, offsetDays: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function compareRowsByDate<T extends Record<string, unknown>>(rows: T[], field: keyof T, range: RangeConfig): { current: number; previous: number | null; trend?: TrendResult } {
  const current = filterByDate(rows, field, range).length;
  if (!range.canCompare || range.compareDays <= 0) return { current, previous: null };
  const today = todayInputValue();
  const currentEnd = range.key === 'yesterday' ? offsetDate(today, -1) : today;
  const currentStart = range.key === 'today' || range.key === 'yesterday' ? currentEnd : offsetDate(currentEnd, -(range.currentDays - 1));
  const previousEnd = offsetDate(currentStart, -1);
  const previousStart = offsetDate(previousEnd, -(range.compareDays - 1));
  const previous = rows.filter((row) => {
    const raw = row[field];
    if (typeof raw !== 'string') return false;
    const key = raw.slice(0, 10);
    return key >= previousStart && key <= previousEnd;
  }).length;
  return { current, previous, trend: buildTrend(current, previous) };
}

function averageMessages(rows: ConversationRow[]) {
  if (rows.length === 0) return 'No Data Yet';
  const total = rows.reduce((sum, row) => sum + safeNumber(row.messageCount ?? row.totalMessages), 0);
  return (Math.round((total / rows.length) * 10) / 10).toLocaleString();
}

function buildRecentActivity(leads: LeadRow[], conversations: ConversationRow[]): ActivityRow[] {
  const leadRows = leads.map((lead) => ({
    id: `lead-${lead.id}`,
    type: 'Lead Captured',
    title: lead.name || lead.email || 'New lead',
    detail: `${lead.scoreLabel} intent from ${lead.website.name}`,
    occurredAt: lead.capturedAt,
  }));
  const conversationRows = conversations.map((conversation) => ({
    id: `conversation-${conversation.id}`,
    type: 'Conversation Started',
    title: conversation.title,
    detail: `${conversation.messageCount ?? conversation.totalMessages} messages`,
    occurredAt: conversation.startedAt,
  }));
  return [...leadRows, ...conversationRows]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 10);
}

function buildTopPerformers(summary: Summary, leads: LeadRow[]): Array<[string, string]> {
  const topWebsite = summary.websitePerformance[0]?.name ?? 'No Data Yet';
  const topPopup = summary.topPopupTypes[0]?.popupType ?? 'No Data Yet';
  const topLeadSource = topLeadSourceName(leads);
  return [
    ['Top Website', topWebsite],
    ['Top CTA', 'Unavailable'],
    ['Top Website Action', 'Unavailable'],
    ['Top Popup', topPopup],
    ['Top Lead Source', topLeadSource],
    ['Top Question Category', 'Coming Soon'],
  ];
}

function topLeadSourceName(leads: LeadRow[]) {
  if (leads.length === 0) return 'No Data Yet';
  const counts = new Map<string, number>();
  for (const lead of leads) counts.set(lead.website.name, (counts.get(lead.website.name) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'No Data Yet';
}

function getLeadStats(leads: LeadRow[]) {
  return leads.reduce((stats, lead) => {
    stats.total += 1;
    if (lead.scoreLabel === 'HIGH') stats.high += 1;
    if (lead.scoreLabel === 'MEDIUM') stats.medium += 1;
    if (lead.scoreLabel === 'LOW') stats.low += 1;
    return stats;
  }, { total: 0, high: 0, medium: 0, low: 0 });
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












