/** Process-local worker backed by durable PostgreSQL claims and leases. */
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { prisma } from '../db/prisma.js';
import { ingest, type IngestPhase } from '../services/ingestService.js';
import { reconcileActionUrlOverridesAfterBuild } from '../business-actions/action.service.js';
import { writeAuditLog } from '../audit/audit.service.js';
import { enqueueAnalyticsEvent } from '../analytics/analytics.service.js';
import { getSnapshotStorage, loadSnapshotArtifact, r2SnapshotKey, snapshotSha256 } from '../vectorstore/snapshotStorage.js';

const workerId = `knowledge-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;
let timer: NodeJS.Timeout | null = null;
let active = 0;

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(api[_ -]?key|secret|token|password)=?[^\s,;]+/gi, '$1=[redacted]').slice(0, 1000);
}
function errorCode(error: unknown): string {
  const message = safeMessage(error).toLowerCase();
  if (/unsafe|invalid start url|invalid url|no readable pages|no chunks|no vectors|not configured|dimension|checksum|invalid json|unsupported schema|embedding model changed/.test(message)) return 'PERMANENT_BUILD_ERROR';
  return 'TRANSIENT_BUILD_ERROR';
}
export function knowledgeBuildRetryDelay(attempt: number) { return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 500); }
export function knowledgeBuildErrorCode(error: unknown): string { return errorCode(error); }

async function reclaimStale(): Promise<void> {
  const now = new Date();
  const stale = await prisma.knowledgeBuild.findMany({ where: { status: 'RUNNING', leaseExpiresAt: { lt: now } }, select: { id: true, attempt: true, maxAttempts: true } });
  for (const job of stale) {
    const exhausted = job.attempt >= job.maxAttempts;
    await prisma.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', leaseExpiresAt: { lt: now } }, data: exhausted
      ? { status: 'FAILED', currentPhase: 'failed', lastErrorCode: 'LEASE_EXPIRED', error: 'Build lease expired after all retry attempts.', finishedAt: now, lockedBy: null, leaseExpiresAt: null }
      : { status: 'RETRY_WAIT', currentPhase: 'retry_wait', lastErrorCode: 'LEASE_EXPIRED', error: 'Worker stopped before build completed; retry scheduled.', lockedBy: null, leaseExpiresAt: null, nextRunAt: new Date(now.getTime() + knowledgeBuildRetryDelay(job.attempt)) },
    });
  }
  await prisma.knowledgeBuild.updateMany({ where: { status: 'RETRY_WAIT', nextRunAt: { lte: now } }, data: { status: 'QUEUED', currentPhase: 'queued' } });
}

async function claimOne() {
  const candidate = await prisma.knowledgeBuild.findFirst({ where: { status: 'QUEUED', nextRunAt: { lte: new Date() } }, orderBy: { nextRunAt: 'asc' } });
  if (!candidate) return null;
  const now = new Date();
  const claimed = await prisma.knowledgeBuild.updateMany({ where: { id: candidate.id, status: 'QUEUED', nextRunAt: { lte: now } }, data: { status: 'RUNNING', currentPhase: 'starting', lockedBy: workerId, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + config.knowledgeWorker.leaseMs), startedAt: now, attempt: { increment: 1 }, error: null, lastErrorCode: null } });
  if (claimed.count !== 1) return null;
  return prisma.knowledgeBuild.findUniqueOrThrow({ where: { id: candidate.id } });
}

async function heartbeat(id: string): Promise<void> {
  const now = new Date();
  await prisma.knowledgeBuild.updateMany({ where: { id, status: 'RUNNING', lockedBy: workerId }, data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + config.knowledgeWorker.leaseMs) } });
}

async function ensureSnapshot(job: Awaited<ReturnType<typeof claimOne>> & {}) {
  if (!job) throw new Error('Missing job');
  let snapshot = job.snapshotId ? await prisma.knowledgeSnapshot.findUnique({ where: { id: job.snapshotId } }) : null;
  if (snapshot?.status === 'READY') {
    const valid = snapshot.storageKey && await loadSnapshotArtifact({ provider: snapshot.storageProvider, storageKey: snapshot.storageKey, contentSha256: snapshot.contentSha256 }).catch(() => null);
    if (valid) return { snapshot, recovered: true };
  }
  if (snapshot?.status === 'BUILDING' && snapshot.storageProvider === 'R2') {
    // A process can die after immutable upload but before DB publish. The key is deterministic.
    const key = snapshot.storageKey || r2SnapshotKey(snapshot.organizationId, snapshot.websiteId, snapshot.id);
    const artifact = await getSnapshotStorage('R2').read(key).catch(() => null);
    if (artifact) {
      const recovered = await loadSnapshotArtifact({ provider: 'R2', storageKey: key }).catch(() => null);
      if (recovered && recovered.embeddingModel === config.gemini.embeddingModel && recovered.documents.every((d) => d.embedding.length === recovered.dimensions)) {
        snapshot = await prisma.knowledgeSnapshot.update({ where: { id: snapshot.id }, data: { status: 'READY', storageKey: key, contentSha256: snapshotSha256(artifact.bytes), contentBytes: artifact.bytes.byteLength, pagesCrawled: recovered.pages.length, chunkCount: recovered.documents.length, dimensions: recovered.dimensions, sourceUrl: recovered.sourceUrl } });
        return { snapshot, recovered: true };
      }
    }
  }
  // The first claimed job uses the snapshot created at enqueue. Later attempts receive a fresh immutable key.
  if (snapshot?.status === 'BUILDING' && !snapshot.storageKey && job.attempt === 1) return { snapshot, recovered: false };
  if (snapshot?.status === 'BUILDING') await prisma.knowledgeSnapshot.update({ where: { id: snapshot.id }, data: { status: 'FAILED', error: 'Previous worker attempt did not publish this snapshot.' } });
  snapshot = await prisma.knowledgeSnapshot.create({ data: { websiteId: job.websiteId, organizationId: job.organizationId, embeddingModel: config.gemini.embeddingModel, dimensions: 0, pagesCrawled: 0, chunkCount: 0, sourceUrl: job.sourceUrl ?? '', status: 'BUILDING', storageProvider: config.knowledgeStorage === 'r2' ? 'R2' : 'LOCAL', storageKey: '' } });
  await prisma.knowledgeBuild.update({ where: { id: job.id }, data: { snapshotId: snapshot.id } });
  return { snapshot, recovered: false };
}

async function run(job: NonNullable<Awaited<ReturnType<typeof claimOne>>>) {
  const leaseTimer = setInterval(() => { void heartbeat(job.id).catch(() => undefined); }, Math.max(5_000, Math.floor(config.knowledgeWorker.leaseMs / 3)));
  try {
    const prepared = await ensureSnapshot(job);
    if (prepared.recovered) {
      await reconcileActionUrlOverridesAfterBuild(job.organizationId, job.websiteId);
      await prisma.knowledgeBuild.update({ where: { id: job.id }, data: { status: 'SUCCESS', currentPhase: 'complete', finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null } });
      return;
    }
    const result = await ingest(job.sourceUrl ?? '', { websiteId: job.websiteId, organizationId: job.organizationId, snapshotId: prepared.snapshot.id, language: job.language ?? undefined, onPhase: async (phase, detail) => {
      const progress = phaseProgress(phase, detail);
      await prisma.knowledgeBuild.update({ where: { id: job.id }, data: { currentPhase: phase, ...progress } });
      await heartbeat(job.id);
    } });
    await prisma.knowledgeSnapshot.update({ where: { id: prepared.snapshot.id }, data: { embeddingModel: config.gemini.embeddingModel, dimensions: result.dimensions, pagesCrawled: result.pages, chunkCount: result.chunks, sourceUrl: job.sourceUrl ?? '', status: 'READY', storageProvider: result.snapshotArtifact.provider, storageKey: result.snapshotArtifact.storageKey, contentSha256: result.snapshotArtifact.contentSha256 || null, contentBytes: result.snapshotArtifact.contentBytes || null, etag: result.snapshotArtifact.etag } });
    await reconcileActionUrlOverridesAfterBuild(job.organizationId, job.websiteId);
    await prisma.knowledgeBuild.update({ where: { id: job.id }, data: { status: 'SUCCESS', currentPhase: 'complete', pages: result.pages, chunks: result.chunks, embeddingsCompleted: result.chunks, finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null } });
    enqueueAnalyticsEvent({ organizationId: job.organizationId, websiteId: job.websiteId }, {}, { category: 'KNOWLEDGE', eventName: 'knowledge_build_completed', knowledgeBuildId: job.id, sourceUrl: job.sourceUrl ?? '', numericValue: result.chunks, durationMs: result.durationMs });
    if (job.requestedByUserId) await writeAuditLog({ action: 'knowledge.built', organizationId: job.organizationId, userId: job.requestedByUserId, targetType: 'website', targetId: job.websiteId, metadata: { pages: result.pages, chunks: result.chunks } });
  } catch (error) {
    const message = safeMessage(error); const code = errorCode(error); const retry = code === 'TRANSIENT_BUILD_ERROR' && job.attempt < job.maxAttempts;
    if (job.snapshotId) await prisma.knowledgeSnapshot.update({ where: { id: job.snapshotId }, data: { status: 'FAILED', error: message } }).catch(() => undefined);
    await prisma.knowledgeBuild.update({ where: { id: job.id }, data: retry ? { status: 'RETRY_WAIT', currentPhase: 'retry_wait', error: message, lastErrorCode: code, nextRunAt: new Date(Date.now() + knowledgeBuildRetryDelay(job.attempt)), lockedBy: null, leaseExpiresAt: null } : { status: 'FAILED', currentPhase: 'failed', error: message, lastErrorCode: code, finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null } });
  } finally { clearInterval(leaseTimer); }
}

function phaseProgress(phase: IngestPhase, detail?: Record<string, unknown>) {
  const n = (key: string) => typeof detail?.[key] === 'number' ? detail[key] as number : undefined;
  return { ...(n('pages') !== undefined ? { pages: n('pages') } : {}), ...(n('skipped') !== undefined ? { pagesSkipped: n('skipped') } : {}), ...(n('discoveredActions') !== undefined ? { actionsDiscovered: n('discoveredActions') } : {}), ...(n('actions') !== undefined ? { actionsDiscovered: n('actions') } : {}), ...(n('chunks') !== undefined ? { chunks: n('chunks') } : {}), ...(n('embedded') !== undefined ? { embeddingsCompleted: n('embedded') } : {}) };
}

async function tick() { if (stopping) return; await reclaimStale(); while (!stopping && active < config.knowledgeWorker.concurrency) { const job = await claimOne(); if (!job) break; active++; void run(job).finally(() => { active--; }); } }
export function startKnowledgeBuildWorker() { stopping = false; void tick(); timer = setInterval(() => { void tick().catch((e) => console.error('[knowledge-worker] tick failed', safeMessage(e))); }, config.knowledgeWorker.pollMs); }
export function stopKnowledgeBuildWorker() { stopping = true; if (timer) clearInterval(timer); timer = null; }
