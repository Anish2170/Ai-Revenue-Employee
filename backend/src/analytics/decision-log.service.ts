import { prisma } from '../db/prisma.js';
import { hasDatabase } from '../config/index.js';
import type { AnalyticsTenant, AnalyticsContext, AnalyticsEventInput } from './analytics.service.js';

export interface AiDecisionLogInput extends AnalyticsContext {
  occurredAt?: Date;
  behaviorSummary?: string | null;
  behaviorDominant?: string | null;
  intentSummary?: string | null;
  intentGoal?: string | null;
  intentReadiness?: string | null;
  salesStrategy?: string | null;
  confidenceScore?: number | null;
  confidenceBand?: string | null;
  speakScore?: number | null;
  decision: string;
  reason?: string | null;
  popupGenerated?: boolean;
  popupSuppressed?: boolean;
  suppressionReason?: string | null;
  generatedPopupType?: string | null;
  generatedPopupTitle?: string | null;
  ctaType?: string | null;
  ctaText?: string | null;
  llmUsed?: boolean;
  validationPassed?: boolean;
  finalOutcome: string;
}

type QueueItem =
  | { type: 'create'; tenant: AnalyticsTenant; input: AiDecisionLogInput }
  | { type: 'outcome'; tenant: AnalyticsTenant; context: AnalyticsContext; event: AnalyticsEventInput };

const queue: QueueItem[] = [];
const MAX_QUEUE = 10_000;
let draining = false;

export function enqueueAiDecisionLog(tenant: AnalyticsTenant | null | undefined, input: AiDecisionLogInput): void {
  if (!hasDatabase || !tenant) return;
  push({ type: 'create', tenant, input });
}

export function enqueueAiDecisionOutcomes(
  tenant: AnalyticsTenant | null | undefined,
  context: AnalyticsContext,
  events: AnalyticsEventInput[],
): void {
  if (!hasDatabase || !tenant || events.length === 0) return;
  for (const event of events) {
    if (outcomePatch(event.eventName)) push({ type: 'outcome', tenant, context, event });
  }
}

function push(item: QueueItem): void {
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push(item);
  scheduleDrain();
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
      const action = item.type === 'create' ? persistDecision(item.tenant, item.input) : persistOutcome(item.tenant, item.context, item.event);
      await action.catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[ai-decision-log] dropped update:', message);
      });
    }
  } finally {
    draining = false;
    if (queue.length > 0) scheduleDrain();
  }
}

async function persistDecision(tenant: AnalyticsTenant, input: AiDecisionLogInput): Promise<void> {
  const merged: AnalyticsContext = { ...input };
  await prisma.aiDecisionLog.create({
    data: {
      organizationId: tenant.organizationId,
      websiteId: tenant.websiteId,
      sessionId: cleanText(input.sessionId, 128) ?? 'unknown-session',
      visitorId: cleanText(input.visitorId, 128),
      occurredAt: input.occurredAt ?? new Date(),
      pageUrl: cleanText(merged.pageUrl, 1024),
      pagePath: cleanText(merged.pagePath, 512),
      pageTitle: cleanText(merged.pageTitle, 512),
      behaviorSummary: cleanText(input.behaviorSummary, 512),
      behaviorDominant: cleanText(input.behaviorDominant, 80),
      intentSummary: cleanText(input.intentSummary, 512),
      intentGoal: cleanText(input.intentGoal, 80),
      intentReadiness: cleanText(input.intentReadiness, 80),
      salesStrategy: cleanText(input.salesStrategy, 80),
      confidenceScore: cleanNumber(input.confidenceScore),
      confidenceBand: cleanText(input.confidenceBand, 40),
      speakScore: cleanNumber(input.speakScore),
      decision: cleanText(input.decision, 80) ?? input.decision,
      reason: cleanText(input.reason, 512),
      popupGenerated: Boolean(input.popupGenerated),
      popupSuppressed: Boolean(input.popupSuppressed),
      suppressionReason: cleanText(input.suppressionReason, 160),
      generatedPopupType: cleanText(input.generatedPopupType, 80),
      generatedPopupTitle: cleanText(input.generatedPopupTitle, 240),
      ctaType: cleanText(input.ctaType, 80),
      ctaText: cleanText(input.ctaText, 120),
      llmUsed: Boolean(input.llmUsed),
      validationPassed: Boolean(input.validationPassed),
      finalOutcome: cleanText(input.finalOutcome, 80) ?? input.finalOutcome,
    },
  });
}

async function persistOutcome(tenant: AnalyticsTenant, context: AnalyticsContext, event: AnalyticsEventInput): Promise<void> {
  const sessionId = cleanText(event.sessionId ?? context.sessionId, 128);
  if (!sessionId) return;

  const patch = outcomePatch(event.eventName);
  if (!patch) return;

  const latest = await prisma.aiDecisionLog.findFirst({
    where: { organizationId: tenant.organizationId, websiteId: tenant.websiteId, sessionId },
    orderBy: { occurredAt: 'desc' },
    select: { id: true },
  });
  if (!latest) return;

  await prisma.aiDecisionLog.update({
    where: { id: latest.id },
    data: {
      ...patch,
      ...(event.popupType ? { generatedPopupType: cleanText(event.popupType, 80) } : {}),
    },
  });
}

function outcomePatch(eventName: string): Record<string, boolean | string> | null {
  if (eventName === 'popup_displayed') return { popupDisplayed: true, finalOutcome: 'Displayed' };
  if (eventName === 'popup_clicked') return { popupClicked: true, finalOutcome: 'Clicked' };
  if (eventName === 'popup_dismissed') return { popupDismissed: true, finalOutcome: 'Dismissed' };
  if (eventName === 'chat_opened') return { chatOpened: true, finalOutcome: 'Chat Opened' };
  return null;
}

function cleanText(value: string | null | undefined, max = 512): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanNumber(value: number | null | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}
