import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { hasDatabase } from '../config/index.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { resolveTenant, TenantDisabledError, TenantNotFoundError } from '../tenant/tenant.resolver.js';
import * as websiteService from '../websites/website.service.js';
import { daysAgoStart, enqueueAnalyticsEvents, startOfToday } from './analytics.service.js';
import { enqueueAiDecisionOutcomes } from './decision-log.service.js';
import type { AnalyticsEventCategory } from '@prisma/client';

export const analyticsRouter = Router();

const categorySchema = z.enum(['VISITOR', 'PAGE', 'POPUP', 'CHAT', 'KNOWLEDGE', 'WIDGET']);

const analyticsEventSchema = z.object({
  category: categorySchema,
  eventName: z.string().min(1).max(80),
  occurredAt: z.string().datetime().optional(),
  pageUrl: z.string().max(1024).optional().nullable(),
  pagePath: z.string().max(512).optional().nullable(),
  pageTitle: z.string().max(512).optional().nullable(),
  referrer: z.string().max(1024).optional().nullable(),
  device: z.string().max(80).optional().nullable(),
  browser: z.string().max(80).optional().nullable(),
  surface: z.string().max(40).optional().nullable(),
  popupType: z.string().max(80).optional().nullable(),
  sourceTitle: z.string().max(512).optional().nullable(),
  sourceUrl: z.string().max(1024).optional().nullable(),
  knowledgeBuildId: z.string().uuid().optional().nullable(),
  durationMs: z.number().nonnegative().max(86_400_000).optional().nullable(),
  numericValue: z.number().optional().nullable(),
  reason: z.string().max(160).optional().nullable(),
  label: z.string().max(240).optional().nullable(),
  actionId: z.string().max(80).optional().nullable(),
});

const analyticsIngestSchema = z.object({
  siteId: z.string().min(1).max(100),
  visitorId: z.string().min(8).max(128),
  sessionId: z.string().min(8).max(128),
  returning: z.boolean().default(false),
  pageUrl: z.string().max(1024).optional().nullable(),
  pagePath: z.string().max(512).optional().nullable(),
  pageTitle: z.string().max(512).optional().nullable(),
  referrer: z.string().max(1024).optional().nullable(),
  device: z.string().max(80).optional().nullable(),
  browser: z.string().max(80).optional().nullable(),
  surface: z.string().max(40).optional().nullable(),
  events: z.array(analyticsEventSchema).min(1).max(50),
});

const chartMetricSchema = z.enum(['daily_visitors', 'daily_chats', 'popup_ctr', 'conversation_trend']);
const decisionFilterSchema = z.enum(['Popup Generated', 'Suppressed']);

async function resolveDashboardWebsiteId(organizationId: string, rawWebsiteId: unknown): Promise<string | undefined> {
  const websiteId = typeof rawWebsiteId === 'string' && rawWebsiteId.trim() ? rawWebsiteId.trim() : undefined;
  if (!websiteId) return undefined;
  await websiteService.assertWebsiteOwnership(organizationId, websiteId);
  return websiteId;
}

analyticsRouter.post('/analytics/events', async (req, res) => {
  const parsed = analyticsIngestSchema.safeParse(req.body);
  if (!parsed.success || !hasDatabase) return res.json({ status: 'ignored' });

  try {
    const body = parsed.data;
    const tenant = await resolveTenant(body.siteId);
    const context = {
      visitorId: body.visitorId,
      sessionId: body.sessionId,
      returning: body.returning,
      pageUrl: body.pageUrl,
      pagePath: body.pagePath,
      pageTitle: body.pageTitle,
      referrer: body.referrer,
      device: body.device,
      browser: body.browser,
      surface: body.surface,
    };
    const events = body.events.map((event) => ({
      ...event,
      category: event.category as AnalyticsEventCategory,
      occurredAt: event.occurredAt ? new Date(event.occurredAt) : undefined,
    }));
    enqueueAnalyticsEvents(tenant, context, events);
    enqueueAiDecisionOutcomes(tenant, context, events);
    return res.json({ status: 'ack', accepted: body.events.length });
  } catch (err) {
    if (err instanceof TenantNotFoundError || err instanceof TenantDisabledError) {
      return res.json({ status: 'ignored' });
    }
    console.warn('[analytics] ingest ignored:', err instanceof Error ? err.message : String(err));
    return res.json({ status: 'ignored' });
  }
});


analyticsRouter.get('/api/analytics/decision-log', requireAuth, async (req, res, next) => {
  try {
    const websiteId = await resolveDashboardWebsiteId(req.auth!.organizationId, req.query.websiteId);
    const exportMode = req.query.export === '1';
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), exportMode ? 5000 : 200);
    const decision = typeof req.query.decision === 'string' && req.query.decision ? decisionFilterSchema.parse(req.query.decision) : undefined;
    const popupType = typeof req.query.popupType === 'string' && req.query.popupType.trim() ? req.query.popupType.trim() : undefined;
    const sessionId = typeof req.query.sessionId === 'string' && req.query.sessionId.trim() ? req.query.sessionId.trim() : undefined;
    const search = typeof req.query.search === 'string' && req.query.search.trim() ? req.query.search.trim() : undefined;
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
    const startDate = typeof req.query.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.startDate) ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endDate) ? req.query.endDate : undefined;
    const dateStart = date ? new Date(`${date}T00:00:00`) : startDate ? new Date(`${startDate}T00:00:00`) : undefined;
    const dateEnd = date
      ? new Date(new Date(`${date}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)
      : endDate
        ? new Date(new Date(`${endDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000)
        : undefined;

    const logs = await prisma.aiDecisionLog.findMany({
      where: {
        organizationId: req.auth!.organizationId,
        ...(websiteId ? { websiteId } : {}),
        ...(decision ? { decision } : {}),
        ...(popupType ? { generatedPopupType: popupType } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(search ? { sessionId: { contains: search, mode: 'insensitive' } } : {}),
        ...(dateStart && dateEnd ? { occurredAt: { gte: dateStart, lt: dateEnd } } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: {
        id: true,
        occurredAt: true,
        websiteId: true,
        website: { select: { name: true, url: true } },
        sessionId: true,
        visitorId: true,
        pageUrl: true,
        pagePath: true,
        pageTitle: true,
        behaviorSummary: true,
        behaviorDominant: true,
        intentSummary: true,
        intentGoal: true,
        intentReadiness: true,
        salesStrategy: true,
        confidenceScore: true,
        confidenceBand: true,
        speakScore: true,
        decision: true,
        reason: true,
        popupGenerated: true,
        popupSuppressed: true,
        suppressionReason: true,
        generatedPopupType: true,
        generatedPopupTitle: true,
        ctaType: true,
        ctaText: true,
        ctaActionId: true,
        expectedAction: true,
        primaryActionReturned: true,
        fallbackApplied: true,
        fallbackUsed: true,
        missingActionReason: true,
        llmUsed: true,
        validationPassed: true,
        finalOutcome: true,
        popupDisplayed: true,
        popupClicked: true,
        popupDismissed: true,
        chatOpened: true,
      },
    });

    res.json({ logs });
  } catch (err) {
    if (err instanceof websiteService.OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
analyticsRouter.get('/api/analytics/summary', requireAuth, async (req, res, next) => {
  try {
    const websiteId = await resolveDashboardWebsiteId(req.auth!.organizationId, req.query.websiteId);
    const base = {
      organizationId: req.auth!.organizationId,
      occurredAt: { gte: startOfToday() },
      ...(websiteId ? { websiteId } : {}),
    };

    const [visitors, conversations, popupDisplayed, popupClicked, chatOpened, messages, aiResponses, endedSessions, decisionStats, persistedConversations, messageRows] = await Promise.all([
      prisma.analyticsEvent.findMany({
        where: { ...base, visitorId: { not: null }, eventName: { in: ['visitor_started', 'session_started', 'page_viewed'] } },
        distinct: ['visitorId'],
        select: { visitorId: true },
      }),
      prisma.analyticsEvent.findMany({
        where: { ...base, sessionId: { not: null }, eventName: { in: ['chat_opened', 'message_sent'] } },
        distinct: ['sessionId'],
        select: { sessionId: true },
      }),
      prisma.analyticsEvent.count({ where: { ...base, eventName: 'popup_displayed' } }),
      prisma.analyticsEvent.count({ where: { ...base, eventName: 'popup_clicked' } }),
      prisma.analyticsEvent.count({ where: { ...base, eventName: 'chat_opened' } }),
      prisma.analyticsEvent.count({ where: { ...base, eventName: 'message_sent' } }),
      prisma.analyticsEvent.count({ where: { ...base, eventName: 'ai_response_completed' } }),
      prisma.analyticsSession.findMany({
        where: { organizationId: req.auth!.organizationId, startedAt: { gte: startOfToday() }, ...(websiteId ? { websiteId } : {}), endedAt: { not: null } },
        select: { engaged: true },
      }),
      prisma.aiDecisionLog.findMany({
        where: { organizationId: req.auth!.organizationId, occurredAt: { gte: startOfToday() }, ...(websiteId ? { websiteId } : {}) },
        select: { visitorId: true, sessionId: true, popupDisplayed: true, popupClicked: true, chatOpened: true },
        take: 5000,
      }),
      prisma.conversation.findMany({
        where: { organizationId: req.auth!.organizationId, startedAt: { gte: startOfToday() }, ...(websiteId ? { websiteId } : {}), deletedAt: null },
        select: { id: true, visitorId: true, sessionId: true },
        take: 5000,
      }),
      prisma.conversationMessage.findMany({
        where: {
          timestamp: { gte: startOfToday() },
          conversation: { organizationId: req.auth!.organizationId, ...(websiteId ? { websiteId } : {}), deletedAt: null },
        },
        select: { role: true, conversationId: true },
        take: 10000,
      }),
    ]);

    const visitorIds = new Set(visitors.map((row) => row.visitorId).filter(Boolean));
    const conversationSessions = new Set(conversations.map((row) => row.sessionId).filter(Boolean));
    let decisionPopupDisplayed = 0;
    let decisionPopupClicked = 0;
    let decisionChatOpened = 0;
    for (const row of decisionStats) {
      if (row.visitorId) visitorIds.add(row.visitorId);
      if (row.sessionId && row.chatOpened) conversationSessions.add(row.sessionId);
      if (row.popupDisplayed) decisionPopupDisplayed += 1;
      if (row.popupClicked) decisionPopupClicked += 1;
      if (row.chatOpened) decisionChatOpened += 1;
    }
    for (const row of persistedConversations) {
      if (row.visitorId) visitorIds.add(row.visitorId);
      conversationSessions.add(row.sessionId ?? row.id);
    }
    const persistedMessages = messageRows.filter((row) => row.role === 'USER').length;
    const persistedAiResponses = messageRows.filter((row) => row.role === 'ASSISTANT').length;

    const totalPopupDisplayed = Math.max(popupDisplayed, decisionPopupDisplayed);
    const totalPopupClicked = Math.max(popupClicked, decisionPopupClicked);
    const totalChatOpened = Math.max(chatOpened, decisionChatOpened, persistedConversations.length);
    const totalMessages = Math.max(messages, persistedMessages);
    const totalAiResponses = Math.max(aiResponses, persistedAiResponses);

    const [topPages, topPopupTypes, deviceBreakdown, websitePerformance] = await Promise.all([
      getTopPages(req.auth!.organizationId, websiteId),
      getTopPopupTypes(req.auth!.organizationId, websiteId),
      getDeviceBreakdown(req.auth!.organizationId, websiteId),
      getWebsitePerformance(req.auth!.organizationId, websiteId),
    ]);

    res.json({
      today: {
        visitors: visitorIds.size,
        conversations: Math.max(conversationSessions.size, persistedConversations.length),
        popupCtr: totalPopupDisplayed === 0 ? 0 : totalPopupClicked / totalPopupDisplayed,
        popupDisplayed: totalPopupDisplayed,
        popupClicked: totalPopupClicked,
        chatOpens: totalChatOpened,
        messages: totalMessages,
        aiResponses: totalAiResponses,
        conversationsEndedWithoutEngagement: endedSessions.filter((s) => !s.engaged).length,
      },
      topPages,
      topPopupTypes,
      deviceBreakdown,
      websitePerformance,
    });
  } catch (err) {
    if (err instanceof websiteService.OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

analyticsRouter.get('/api/analytics/charts', requireAuth, async (req, res, next) => {
  try {
    const metric = chartMetricSchema.parse(req.query.metric ?? 'daily_visitors');
    const days = Math.min(Math.max(Number(req.query.days ?? 14) || 14, 1), 60);
    const websiteId = await resolveDashboardWebsiteId(req.auth!.organizationId, req.query.websiteId);
    const data = await getChart(req.auth!.organizationId, metric, days, websiteId);
    res.json({ metric, days, data });
  } catch (err) {
    if (err instanceof websiteService.OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

async function getTopPages(organizationId: string, websiteId?: string) {
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      organizationId,
      occurredAt: { gte: startOfToday() },
      eventName: { in: ['chat_opened', 'message_sent'] },
      pagePath: { not: null },
      ...(websiteId ? { websiteId } : {}),
    },
    select: { pagePath: true, pageTitle: true, sessionId: true },
    take: 1000,
  });
  const byPage = new Map<string, { pagePath: string; pageTitle: string | null; sessions: Set<string>; events: number }>();
  for (const row of rows) {
    if (!row.pagePath) continue;
    const existing = byPage.get(row.pagePath) ?? { pagePath: row.pagePath, pageTitle: row.pageTitle, sessions: new Set<string>(), events: 0 };
    if (row.sessionId) existing.sessions.add(row.sessionId);
    existing.events += 1;
    byPage.set(row.pagePath, existing);
  }
  return Array.from(byPage.values())
    .map((row) => ({ pagePath: row.pagePath, pageTitle: row.pageTitle, conversations: row.sessions.size, events: row.events }))
    .sort((a, b) => b.conversations - a.conversations || b.events - a.events)
    .slice(0, 8);
}

async function getTopPopupTypes(organizationId: string, websiteId?: string) {
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      organizationId,
      occurredAt: { gte: startOfToday() },
      eventName: { in: ['popup_displayed', 'popup_clicked'] },
      popupType: { not: null },
      ...(websiteId ? { websiteId } : {}),
    },
    select: { popupType: true, eventName: true },
    take: 1000,
  });
  const byType = new Map<string, { popupType: string; displayed: number; clicked: number }>();
  for (const row of rows) {
    if (!row.popupType) continue;
    const existing = byType.get(row.popupType) ?? { popupType: row.popupType, displayed: 0, clicked: 0 };
    if (row.eventName === 'popup_displayed') existing.displayed += 1;
    if (row.eventName === 'popup_clicked') existing.clicked += 1;
    byType.set(row.popupType, existing);
  }
  return Array.from(byType.values())
    .map((row) => ({ ...row, ctr: row.displayed === 0 ? 0 : row.clicked / row.displayed }))
    .sort((a, b) => b.ctr - a.ctr || b.clicked - a.clicked)
    .slice(0, 8);
}

async function getDeviceBreakdown(organizationId: string, websiteId?: string) {
  const rows = await prisma.analyticsSession.groupBy({
    by: ['device'],
    where: { organizationId, startedAt: { gte: startOfToday() }, ...(websiteId ? { websiteId } : {}) },
    _count: { _all: true },
  });
  return rows
    .map((row) => ({ device: row.device ?? 'Unknown', sessions: row._count._all }))
    .sort((a, b) => b.sessions - a.sessions);
}

async function getWebsitePerformance(organizationId: string, websiteId?: string) {
  const rows = await prisma.analyticsEvent.findMany({
    where: { organizationId, occurredAt: { gte: startOfToday() }, eventName: { in: ['visitor_started', 'chat_opened', 'message_sent', 'popup_clicked'] }, ...(websiteId ? { websiteId } : {}) },
    select: { websiteId: true, eventName: true, visitorId: true, sessionId: true, website: { select: { name: true, url: true } } },
    take: 3000,
  });
  const byWebsite = new Map<string, { websiteId: string; name: string; url: string; visitors: Set<string>; conversations: Set<string>; popupClicks: number }>();
  for (const row of rows) {
    const existing = byWebsite.get(row.websiteId) ?? { websiteId: row.websiteId, name: row.website.name, url: row.website.url, visitors: new Set<string>(), conversations: new Set<string>(), popupClicks: 0 };
    if (row.visitorId && row.eventName === 'visitor_started') existing.visitors.add(row.visitorId);
    if (row.sessionId && (row.eventName === 'chat_opened' || row.eventName === 'message_sent')) existing.conversations.add(row.sessionId);
    if (row.eventName === 'popup_clicked') existing.popupClicks += 1;
    byWebsite.set(row.websiteId, existing);
  }
  return Array.from(byWebsite.values())
    .map((row) => ({ websiteId: row.websiteId, name: row.name, url: row.url, visitors: row.visitors.size, conversations: row.conversations.size, popupClicks: row.popupClicks }))
    .sort((a, b) => b.conversations - a.conversations || b.visitors - a.visitors)
    .slice(0, 8);
}

async function getChart(organizationId: string, metric: z.infer<typeof chartMetricSchema>, days: number, websiteId?: string) {
  const from = daysAgoStart(days);
  const events = await prisma.analyticsEvent.findMany({
    where: {
      organizationId,
      occurredAt: { gte: from },
      ...(websiteId ? { websiteId } : {}),
      eventName: { in: chartEventNames(metric) },
    },
    select: { occurredAt: true, eventName: true, visitorId: true, sessionId: true },
    take: 5000,
  });

  const daysList = Array.from({ length: days }, (_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    return dayKey(d);
  });

  const buckets = new Map(daysList.map((key) => [key, { visitors: new Set<string>(), chats: new Set<string>(), conversations: new Set<string>(), displayed: 0, clicked: 0, messages: 0 }]));
  for (const event of events) {
    const bucket = buckets.get(dayKey(event.occurredAt));
    if (!bucket) continue;
    if (event.eventName === 'visitor_started' && event.visitorId) bucket.visitors.add(event.visitorId);
    if (event.eventName === 'chat_opened' && event.sessionId) bucket.chats.add(event.sessionId);
    if ((event.eventName === 'chat_opened' || event.eventName === 'message_sent') && event.sessionId) bucket.conversations.add(event.sessionId);
    if (event.eventName === 'popup_displayed') bucket.displayed += 1;
    if (event.eventName === 'popup_clicked') bucket.clicked += 1;
    if (event.eventName === 'message_sent') bucket.messages += 1;
  }

  return daysList.map((date) => {
    const bucket = buckets.get(date)!;
    const value = metric === 'daily_visitors'
      ? bucket.visitors.size
      : metric === 'daily_chats'
        ? bucket.chats.size
        : metric === 'popup_ctr'
          ? (bucket.displayed === 0 ? 0 : bucket.clicked / bucket.displayed)
          : bucket.conversations.size;
    return { date, value, displayed: bucket.displayed, clicked: bucket.clicked, messages: bucket.messages };
  });
}

function chartEventNames(metric: z.infer<typeof chartMetricSchema>): string[] {
  if (metric === 'daily_visitors') return ['visitor_started'];
  if (metric === 'daily_chats') return ['chat_opened'];
  if (metric === 'popup_ctr') return ['popup_displayed', 'popup_clicked'];
  return ['chat_opened', 'message_sent'];
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}


