import { prisma } from '../db/prisma.js';
import { hasDatabase } from '../config/index.js';
import type { AnalyticsEventCategory } from '@prisma/client';

export interface AnalyticsTenant {
  organizationId: string;
  websiteId: string;
}

export interface AnalyticsContext {
  visitorId?: string | null;
  sessionId?: string | null;
  returning?: boolean;
  pageUrl?: string | null;
  pagePath?: string | null;
  pageTitle?: string | null;
  referrer?: string | null;
  device?: string | null;
  browser?: string | null;
  surface?: string | null;
}

export interface AnalyticsEventInput extends AnalyticsContext {
  category: AnalyticsEventCategory;
  eventName: string;
  occurredAt?: Date;
  popupType?: string | null;
  sourceTitle?: string | null;
  sourceUrl?: string | null;
  knowledgeBuildId?: string | null;
  durationMs?: number | null;
  numericValue?: number | null;
  reason?: string | null;
  label?: string | null;
}

interface QueueItem {
  tenant: AnalyticsTenant;
  context: AnalyticsContext;
  event: AnalyticsEventInput;
}

const queue: QueueItem[] = [];
const MAX_QUEUE = 10_000;
let draining = false;

function cleanText(value: string | null | undefined, max = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanDuration(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.round(value), 1000 * 60 * 60 * 24);
}

function cleanNumber(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function scheduleDrain(): void {
  if (draining) return;
  draining = true;
  setImmediate(() => {
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  try {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      await persistEvent(item).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[analytics] dropped event:', message);
      });
    }
  } finally {
    draining = false;
    if (queue.length > 0) scheduleDrain();
  }
}

export function enqueueAnalyticsEvents(
  tenant: AnalyticsTenant | null | undefined,
  context: AnalyticsContext,
  events: AnalyticsEventInput[],
): void {
  if (!hasDatabase || !tenant || events.length === 0) return;

  for (const event of events) {
    if (queue.length >= MAX_QUEUE) queue.shift();
    queue.push({ tenant, context, event });
  }
  scheduleDrain();
}

export function enqueueAnalyticsEvent(
  tenant: AnalyticsTenant | null | undefined,
  context: AnalyticsContext,
  event: AnalyticsEventInput,
): void {
  enqueueAnalyticsEvents(tenant, context, [event]);
}

async function persistEvent({ tenant, context, event }: QueueItem): Promise<void> {
  const occurredAt = event.occurredAt ?? new Date();
  const merged: AnalyticsContext = { ...context, ...event };
  const visitorId = cleanText(merged.visitorId, 128);
  const sessionId = cleanText(merged.sessionId, 128);

  let analyticsVisitorId: string | undefined;
  let analyticsSessionId: string | undefined;

  if (visitorId) {
    const visitor = await prisma.analyticsVisitor.upsert({
      where: { websiteId_visitorId: { websiteId: tenant.websiteId, visitorId } },
      create: {
        organizationId: tenant.organizationId,
        websiteId: tenant.websiteId,
        visitorId,
        returning: Boolean(merged.returning),
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
      },
      update: {
        lastSeenAt: occurredAt,
        ...(merged.returning ? { returning: true } : {}),
      },
      select: { id: true },
    });
    analyticsVisitorId = visitor.id;
  }

  if (visitorId && sessionId && analyticsVisitorId) {
    const session = await prisma.analyticsSession.upsert({
      where: { websiteId_sessionId: { websiteId: tenant.websiteId, sessionId } },
      create: {
        organizationId: tenant.organizationId,
        websiteId: tenant.websiteId,
        analyticsVisitorId,
        sessionId,
        startedAt: occurredAt,
        returning: Boolean(merged.returning),
        device: cleanText(merged.device, 80),
        browser: cleanText(merged.browser, 80),
        referrer: cleanText(merged.referrer, 1024),
        entryPagePath: cleanText(merged.pagePath, 512),
      },
      update: {
        ...(merged.returning ? { returning: true } : {}),
        ...(cleanText(merged.device, 80) ? { device: cleanText(merged.device, 80) } : {}),
        ...(cleanText(merged.browser, 80) ? { browser: cleanText(merged.browser, 80) } : {}),
        ...(cleanText(merged.referrer, 1024) ? { referrer: cleanText(merged.referrer, 1024) } : {}),
        ...(event.eventName === 'session_ended' ? { endedAt: occurredAt, durationMs: cleanDuration(event.durationMs) } : {}),
        ...(isEngagementEvent(event.eventName) ? { engaged: true } : {}),
        ...(event.eventName === 'message_sent' ? { messageCount: { increment: 1 } } : {}),
        ...(event.eventName === 'ai_response_completed' ? { aiResponseCount: { increment: 1 } } : {}),
      },
      select: { id: true },
    });
    analyticsSessionId = session.id;
  }

  await prisma.analyticsEvent.create({
    data: {
      organizationId: tenant.organizationId,
      websiteId: tenant.websiteId,
      analyticsVisitorId,
      analyticsSessionId,
      visitorId,
      sessionId,
      category: event.category,
      eventName: cleanText(event.eventName, 80) ?? event.eventName,
      occurredAt,
      pageUrl: cleanText(event.pageUrl ?? context.pageUrl, 1024),
      pagePath: cleanText(event.pagePath ?? context.pagePath, 512),
      pageTitle: cleanText(event.pageTitle ?? context.pageTitle, 512),
      referrer: cleanText(event.referrer ?? context.referrer, 1024),
      device: cleanText(event.device ?? context.device, 80),
      browser: cleanText(event.browser ?? context.browser, 80),
      surface: cleanText(event.surface ?? context.surface, 40),
      popupType: cleanText(event.popupType, 80),
      sourceTitle: cleanText(event.sourceTitle, 512),
      sourceUrl: cleanText(event.sourceUrl, 1024),
      knowledgeBuildId: cleanText(event.knowledgeBuildId, 64),
      durationMs: cleanDuration(event.durationMs),
      numericValue: cleanNumber(event.numericValue),
      reason: cleanText(event.reason, 160),
      label: cleanText(event.label, 240),
    },
  });
}

function isEngagementEvent(eventName: string): boolean {
  return eventName === 'chat_opened' || eventName === 'message_sent' || eventName === 'popup_clicked' || eventName === 'source_button_clicked';
}

export function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function daysAgoStart(days: number): Date {
  const start = startOfToday();
  start.setDate(start.getDate() - Math.max(0, days - 1));
  return start;
}