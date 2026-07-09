/**
 * Knowledge build service — orchestrates ingestion with DB build/snapshot
 * records and emits phase events for SSE streaming.
 */
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { ingest } from '../services/ingestService.js';
import { writeAuditLog } from '../audit/audit.service.js';
import { enqueueAnalyticsEvent } from '../analytics/analytics.service.js';
import type { IngestPhase } from '../services/ingestService.js';

export type BuildPhaseEvent = {
  phase: IngestPhase;
  detail?: Record<string, unknown>;
};

export interface BuildProgress {
  buildId: string;
  events: AsyncIterable<BuildPhaseEvent>;
}

/**
 * Start a knowledge build for a website. Returns an async iterable of phase
 * events the route can relay as SSE.
 */
export async function startBuild(
  organizationId: string,
  websiteId: string,
  sourceUrl: string,
  userId: string,
  language?: string,
): Promise<BuildProgress> {
  const build = await prisma.knowledgeBuild.create({
    data: {
      websiteId,
      organizationId,
      status: 'RUNNING',
      currentPhase: 'crawling',
    },
  });

  const analyticsTenant = { organizationId, websiteId };
  enqueueAnalyticsEvent(analyticsTenant, {}, {
    category: 'KNOWLEDGE',
    eventName: 'knowledge_build_started',
    knowledgeBuildId: build.id,
    sourceUrl,
  });

  const events: BuildPhaseEvent[] = [];
  const state = { resolve: null as (() => void) | null, done: false };

  const queue = {
    async *[Symbol.asyncIterator](): AsyncIterableIterator<BuildPhaseEvent> {
      let idx = 0;
      while (!state.done || idx < events.length) {
        if (idx < events.length) {
          yield events[idx++];
        } else {
          await new Promise<void>((r) => { state.resolve = r; });
        }
      }
    },
  };

  const notify = () => { state.resolve?.(); state.resolve = null; };

  const onPhase = (phase: IngestPhase, detail?: Record<string, unknown>) => {
    events.push({ phase, detail });
    prisma.knowledgeBuild.update({
      where: { id: build.id },
      data: { currentPhase: phase, ...(detail?.pages ? { pages: detail.pages as number } : {}), ...(detail?.chunks ? { chunks: detail.chunks as number } : {}) },
    }).catch(() => {});
    notify();
  };

  // Run ingestion in the background (don't await — caller consumes events via the iterable)
  (async () => {
    try {
      const result = await ingest(sourceUrl, {
        websiteId,
        organizationId,
        language,
        onPhase,
      });

      // Create snapshot record
      const snapshot = await prisma.knowledgeSnapshot.create({
        data: {
          websiteId,
          organizationId,
          embeddingModel: config.gemini.embeddingModel,
          dimensions: result.dimensions,
          pagesCrawled: result.pages,
          chunkCount: result.chunks,
          sourceUrl,
          status: 'READY',
          storageKey: result.snapshotPath,
        },
      });

      await prisma.knowledgeBuild.update({
        where: { id: build.id },
        data: {
          status: 'SUCCESS',
          snapshotId: snapshot.id,
          pages: result.pages,
          chunks: result.chunks,
          finishedAt: new Date(),
        },
      });

      enqueueAnalyticsEvent(analyticsTenant, {}, {
        category: 'KNOWLEDGE',
        eventName: 'knowledge_build_completed',
        knowledgeBuildId: build.id,
        sourceUrl,
        numericValue: result.chunks,
        durationMs: result.durationMs,
      });

      events.push({ phase: 'saving', detail: { done: true, pages: result.pages, chunks: result.chunks, durationMs: result.durationMs } });

      await writeAuditLog({
        action: 'knowledge.built',
        organizationId,
        userId,
        targetType: 'website',
        targetId: websiteId,
        metadata: { pages: result.pages, chunks: result.chunks },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await prisma.knowledgeBuild.update({
        where: { id: build.id },
        data: { status: 'FAILED', error: message, finishedAt: new Date() },
      }).catch(() => {});
      enqueueAnalyticsEvent(analyticsTenant, {}, {
        category: 'KNOWLEDGE',
        eventName: 'knowledge_build_failed',
        knowledgeBuildId: build.id,
        sourceUrl,
        reason: message,
      });
      events.push({ phase: 'crawling', detail: { error: message } });
    } finally {
      state.done = true;
      notify();
    }
  })();

  return { buildId: build.id, events: queue };
}

/** Get the latest snapshot status for a website. */
export async function getKnowledgeStatus(websiteId: string) {
  const [latestSnapshot, latestBuild] = await Promise.all([
    prisma.knowledgeSnapshot.findFirst({
      where: { websiteId, status: 'READY' },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.knowledgeBuild.findFirst({
      where: { websiteId },
      orderBy: { startedAt: 'desc' },
    }),
  ]);

  return {
    hasKnowledge: !!latestSnapshot,
    snapshot: latestSnapshot ? {
      id: latestSnapshot.id,
      pagesCrawled: latestSnapshot.pagesCrawled,
      chunkCount: latestSnapshot.chunkCount,
      sourceUrl: latestSnapshot.sourceUrl,
      embeddingModel: latestSnapshot.embeddingModel,
      dimensions: latestSnapshot.dimensions,
      createdAt: latestSnapshot.createdAt,
    } : null,
    lastBuild: latestBuild ? {
      id: latestBuild.id,
      status: latestBuild.status,
      currentPhase: latestBuild.currentPhase,
      pages: latestBuild.pages,
      chunks: latestBuild.chunks,
      error: latestBuild.error,
      startedAt: latestBuild.startedAt,
      finishedAt: latestBuild.finishedAt,
    } : null,
  };
}

/** List build history for a website. */
export async function listBuilds(websiteId: string, limit = 10) {
  return prisma.knowledgeBuild.findMany({
    where: { websiteId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      status: true,
      currentPhase: true,
      pages: true,
      chunks: true,
      error: true,
      startedAt: true,
      finishedAt: true,
    },
  });
}
