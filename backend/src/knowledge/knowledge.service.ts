/** Durable PostgreSQL queue and status operations for knowledge builds. */
import { Prisma } from '@prisma/client';
import { config } from '../config/index.js';
import { prisma } from '../db/prisma.js';
import { randomUUID } from 'node:crypto';

const ACTIVE = ['QUEUED', 'RUNNING', 'RETRY_WAIT'] as const;

export type KnowledgeBuildStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export async function enqueueBuild(
  organizationId: string, websiteId: string, sourceUrl: string, userId: string, language?: string, idempotencyKey?: string,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // This serializes enqueue attempts for this website across all web instances.
      await tx.$queryRaw`SELECT "id" FROM "Website" WHERE "id" = ${websiteId}::uuid FOR UPDATE`;
      const active = await tx.knowledgeBuild.findFirst({
        where: { websiteId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: 'desc' },
      });
      if (active) return { build: active, created: false };

      const snapshot = await tx.knowledgeSnapshot.create({
        data: {
          id: randomUUID(), websiteId, organizationId, sourceUrl,
          embeddingModel: config.gemini.embeddingModel, dimensions: 0, pagesCrawled: 0, chunkCount: 0,
          status: 'BUILDING', storageProvider: config.knowledgeStorage === 'r2' ? 'R2' : 'LOCAL', storageKey: '',
        },
      });
      const build = await tx.knowledgeBuild.create({
        data: { websiteId, organizationId, snapshotId: snapshot.id, status: 'QUEUED', currentPhase: 'queued', requestedByUserId: userId, sourceUrl, language: language ?? null, idempotencyKey: idempotencyKey ?? null, maxAttempts: 3 },
      });
      return { build, created: true };
    });
  } catch (error) {
    // The partial unique index is the final race guard if an enqueue arrives outside the row lock.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const active = await prisma.knowledgeBuild.findFirst({ where: { websiteId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: 'desc' } });
      if (active) return { build: active, created: false };
    }
    throw error;
  }
}

function publicBuild(build: Awaited<ReturnType<typeof prisma.knowledgeBuild.findUniqueOrThrow>>) {
  return {
    id: build.id, status: build.status, phase: build.currentPhase,
    progress: { pages: build.pages, pagesSkipped: build.pagesSkipped, actionsDiscovered: build.actionsDiscovered, chunks: build.chunks, embeddingsCompleted: build.embeddingsCompleted },
    attempt: build.attempt, maxAttempts: build.maxAttempts, error: build.error,
    startedAt: build.startedAt, finishedAt: build.finishedAt, createdAt: build.createdAt,
  };
}

export async function getBuildStatus(organizationId: string, websiteId: string, buildId: string) {
  const build = await prisma.knowledgeBuild.findFirst({ where: { id: buildId, organizationId, websiteId } });
  return build ? publicBuild(build) : null;
}

/** Get the latest snapshot status and the latest durable job, for refresh/reopen UI recovery. */
export async function getKnowledgeStatus(websiteId: string) {
  const [latestSnapshot, latestBuild] = await Promise.all([
    prisma.knowledgeSnapshot.findFirst({ where: { websiteId, status: 'READY' }, orderBy: { createdAt: 'desc' } }),
    prisma.knowledgeBuild.findFirst({ where: { websiteId }, orderBy: { createdAt: 'desc' } }),
  ]);
  return {
    hasKnowledge: !!latestSnapshot,
    snapshot: latestSnapshot ? { id: latestSnapshot.id, pagesCrawled: latestSnapshot.pagesCrawled, chunkCount: latestSnapshot.chunkCount, sourceUrl: latestSnapshot.sourceUrl, embeddingModel: latestSnapshot.embeddingModel, dimensions: latestSnapshot.dimensions, createdAt: latestSnapshot.createdAt } : null,
    lastBuild: latestBuild ? publicBuild(latestBuild) : null,
  };
}

export async function listBuilds(websiteId: string, limit = 10) {
  const builds = await prisma.knowledgeBuild.findMany({ where: { websiteId }, orderBy: { createdAt: 'desc' }, take: limit });
  return builds.map(publicBuild);
}
