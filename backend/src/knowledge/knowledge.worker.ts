/** Process-local worker backed by durable PostgreSQL claims and leases. */
import { randomUUID } from 'node:crypto';
import { config, hasDatabase } from '../config/index.js';
import { prisma } from '../db/prisma.js';
import { ingest, IncompleteBuildError, type IngestPhase, type IngestResult } from '../services/ingestService.js';
import { reconcileActionUrlOverridesAfterBuild } from '../business-actions/action.service.js';
import { writeAuditLog } from '../audit/audit.service.js';
import { enqueueAnalyticsEvent } from '../analytics/analytics.service.js';
import { getSnapshotStorage, loadSnapshotArtifact, r2SnapshotKey, snapshotSha256 } from '../vectorstore/snapshotStorage.js';
import { cleanupKnowledgeSnapshots } from './snapshot-retention.js';
import { publishKnowledgeBuild, validateKnowledgeSnapshot, LeaseLostError } from './publication.js';
import { invalidateWebsiteStore } from '../vectorstore/registry.js';
import { websiteSnapshotPath } from '../vectorstore/persistence.js';
import { join } from 'node:path';
import { readBuildConfiguration, ScopeError } from './crawlScope.js';
const workerId = `knowledge-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;
let timer: NodeJS.Timeout | null = null;
let active = 0;
const cancellations = new Map<string, AbortController>();
function safeMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/(api[_ -]?key|secret|token|password)=?[^\s,;]+/gi, '$1=[redacted]').slice(0, 1000);
}
function errorCode(error: unknown): string {
    if (error instanceof ScopeError) return 'PERMANENT_BUILD_ERROR';
    if (error instanceof IncompleteBuildError)
        return 'PARTIAL_CRAWL';
    const message = safeMessage(error).toLowerCase();
    if (/unsafe|invalid start url|invalid url|no readable pages|no chunks|no vectors|not configured|invalid vectors|incomplete vectors|dimension|checksum|invalid json|unsupported schema|embedding model changed/.test(message))
        return 'PERMANENT_BUILD_ERROR';
    return 'TRANSIENT_BUILD_ERROR';
}
export function knowledgeBuildRetryDelay(attempt: number) { return Math.min(60000, 1000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(Math.random() * 500); }
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
    if (!candidate)
        return null;
    const now = new Date();
    const claimed = await prisma.knowledgeBuild.updateMany({ where: { id: candidate.id, status: 'QUEUED', nextRunAt: { lte: now } }, data: { status: 'RUNNING', currentPhase: 'starting', lockedBy: workerId, heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + config.knowledgeWorker.leaseMs), startedAt: now, attempt: { increment: 1 }, pages: null, pagesSkipped: null, chunks: null, embeddingsCompleted: null, actionsDiscovered: null, actionsTotal: null, actionsCompleted: null, crawlLimit: null, error: null, lastErrorCode: null } });
    if (claimed.count !== 1)
        return null;
    return prisma.knowledgeBuild.findUniqueOrThrow({ where: { id: candidate.id } });
}
async function heartbeat(job: NonNullable<Awaited<ReturnType<typeof claimOne>>>): Promise<void> {
    await prisma.$transaction(async tx => {
        // A heartbeat may itself wait behind cancellation/reclamation or another
        // row owner. Check expiry only after that wait, under the same row lock.
        await tx.$queryRaw`SELECT "id" FROM "KnowledgeBuild" WHERE "id" = ${job.id}::uuid FOR UPDATE`;
        const now = new Date();
        const changed = await tx.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId, attempt: job.attempt, leaseExpiresAt: { gt: now } }, data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + config.knowledgeWorker.leaseMs) } });
        if (changed.count !== 1)
            throw new LeaseLostError();
    });
}
export async function ensureKnowledgeSnapshot(job: NonNullable<Awaited<ReturnType<typeof claimOne>>>) {
    let snapshot = job.snapshotId ? await prisma.knowledgeSnapshot.findUnique({ where: { id: job.snapshotId } }) : null;
    if (snapshot && (snapshot.websiteId !== job.websiteId || snapshot.organizationId !== job.organizationId))
        throw new LeaseLostError();
    if (snapshot?.status === 'READY') {
        const valid = await loadSnapshotArtifact({ provider: snapshot.storageProvider, storageKey: snapshot.storageKey, contentSha256: snapshot.contentSha256 });
        if (valid) {
            validateKnowledgeSnapshot(valid);
            const changed = await prisma.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId, attempt: job.attempt, leaseExpiresAt: { gt: new Date() } }, data: { status: 'SUCCESS', currentPhase: 'complete', finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null } });
            if (changed.count !== 1)
                throw new LeaseLostError();
            return { snapshot, recovered: true };
        }
    }
    if (snapshot?.status === 'BUILDING') {
        const key = snapshot.storageKey || (snapshot.storageProvider === 'R2' ? r2SnapshotKey(snapshot.organizationId, snapshot.websiteId, snapshot.id) : join(websiteSnapshotPath(snapshot.websiteId) + '.versions', snapshot.id + '.json'));
        const artifact = await getSnapshotStorage(snapshot.storageProvider).read(key).catch(() => null);
        if (artifact) {
            const recovered = await loadSnapshotArtifact({ provider: snapshot.storageProvider, storageKey: key }).catch(() => null);
            if (recovered?.publication?.id === snapshot.id && (recovered.scopeApproval || recovered.publication.completeness === 'complete' && recovered.crawlManifest?.completeWithinScope)) {
                validateKnowledgeSnapshot(recovered);
                await publishKnowledgeBuild(job, snapshot.id, { provider: snapshot.storageProvider, storageKey: key, contentSha256: snapshotSha256(artifact.bytes), contentBytes: artifact.bytes.length, etag: artifact.etag }, recovered);
                return { snapshot, recovered: true };
            }
        }
    }
    if (snapshot?.status === 'BUILDING' && !snapshot.storageKey && job.attempt === 1)
        return { snapshot, recovered: false };
    if (snapshot?.status === 'BUILDING')
        await prisma.knowledgeSnapshot.updateMany({ where: { id: snapshot.id, status: 'BUILDING' }, data: { status: 'FAILED', error: 'Previous worker attempt did not publish this snapshot.' } });
    snapshot = await prisma.knowledgeSnapshot.create({ data: { websiteId: job.websiteId, organizationId: job.organizationId, embeddingModel: config.gemini.embeddingModel, dimensions: 0, pagesCrawled: 0, chunkCount: 0, sourceUrl: job.sourceUrl ?? '', status: 'BUILDING', storageProvider: config.knowledgeStorage === 'r2' ? 'R2' : 'LOCAL', storageKey: '' } });
    const changed = await prisma.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId, attempt: job.attempt, leaseExpiresAt: { gt: new Date() } }, data: { snapshotId: snapshot.id } });
    if (changed.count !== 1)
        throw new LeaseLostError();
    return { snapshot, recovered: false };
}
async function run(job: NonNullable<Awaited<ReturnType<typeof claimOne>>>) {
    const controller = new AbortController();
    cancellations.set(job.id, controller);
    let snapshotId = job.snapshotId, published = false;
    let buildResult: IngestResult | undefined;
    const assertCurrent = async () => { controller.signal.throwIfAborted(); const current = await prisma.knowledgeBuild.findFirst({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId, attempt: job.attempt, leaseExpiresAt: { gt: new Date() } } }); if (!current)
        throw new LeaseLostError(); };
    const leaseTimer = setInterval(() => { void heartbeat(job).catch(error => controller.abort(error)); }, Math.max(5000, Math.floor(config.knowledgeWorker.leaseMs / 3)));
    try {
        await assertCurrent();
        const configuration = readBuildConfiguration(job.configuration);
        const prepared = await ensureKnowledgeSnapshot(job);
        snapshotId = prepared.snapshot.id;
        if (!prepared.recovered) {
            const result = await ingest(job.sourceUrl ?? '', { crawlBudget: configuration?.budget, scopeApproval: configuration?.approval, websiteId: job.websiteId, organizationId: job.organizationId, snapshotId, language: job.language ?? undefined, signal: controller.signal, assertCurrent, onPhase: async (phase, detail) => {
                    await assertCurrent();
                    const changed = await prisma.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId, attempt: job.attempt, leaseExpiresAt: { gt: new Date() } }, data: { currentPhase: phase, ...phaseProgress(phase, detail) } });
                    if (changed.count !== 1)
                        throw new LeaseLostError();
                    await heartbeat(job);
                } });
            buildResult = result;
            await publishKnowledgeBuild({ ...job, lockedBy: workerId }, snapshotId, result.snapshotArtifact, result.snapshot);
        }
        published = true;
        invalidateWebsiteStore(job.websiteId);
        // Post-publication bookkeeping cannot invalidate an already committed version.
        await reconcileActionUrlOverridesAfterBuild(job.organizationId, job.websiteId).catch(() => console.warn('[knowledge-worker] action reconciliation deferred.'));
        await cleanupKnowledgeSnapshots(job.organizationId, job.websiteId);
        if (buildResult) {
            try {
                enqueueAnalyticsEvent({ organizationId: job.organizationId, websiteId: job.websiteId }, {}, { category: 'KNOWLEDGE', eventName: 'knowledge_build_completed', knowledgeBuildId: job.id, sourceUrl: job.sourceUrl ?? '', numericValue: buildResult.chunks, durationMs: buildResult.durationMs });
            }
            catch {
                console.warn('[knowledge-worker] analytics write deferred.');
            }
        }
        if (buildResult && job.requestedByUserId)
            await writeAuditLog({ action: 'knowledge.built', organizationId: job.organizationId, userId: job.requestedByUserId, targetType: 'website', targetId: job.websiteId, metadata: { snapshotId, pages: buildResult.pages, chunks: buildResult.chunks } }).catch(() => console.warn('[knowledge-worker] audit write deferred.'));
    }
    catch (error) {
        if (published)
            return;
        const code = errorCode(error), retry = code === 'TRANSIENT_BUILD_ERROR' && job.attempt < job.maxAttempts;
        const message = code === 'PARTIAL_CRAWL' ? 'Crawl incomplete; previous usable knowledge retained. Review failed sources or crawl limits.' : code === 'PERMANENT_BUILD_ERROR' ? 'Build cannot complete with the current source or configuration; previous knowledge retained.' : 'Build interrupted; previous usable knowledge retained.';
        const changed = await prisma.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: workerId, attempt: job.attempt, leaseExpiresAt: { gt: new Date() } }, data: retry ? { status: 'RETRY_WAIT', currentPhase: 'retry_wait', error: message, lastErrorCode: code, nextRunAt: new Date(Date.now() + knowledgeBuildRetryDelay(job.attempt)), lockedBy: null, leaseExpiresAt: null } : { status: 'FAILED', currentPhase: code === 'PARTIAL_CRAWL' ? 'partial' : 'failed', error: message, lastErrorCode: code, finishedAt: new Date(), lockedBy: null, leaseExpiresAt: null } });
        if (changed.count === 1 && snapshotId) {
            const artifact = error instanceof IncompleteBuildError ? error.artifact : buildResult?.snapshotArtifact;
            await prisma.knowledgeSnapshot.updateMany({ where: { id: snapshotId, status: 'BUILDING' }, data: { status: 'FAILED', error: message, ...(artifact ? { storageKey: artifact.storageKey, storageProvider: artifact.provider, contentSha256: artifact.contentSha256, contentBytes: artifact.contentBytes } : {}) } }).catch(() => undefined);
        }
    }
    finally {
        clearInterval(leaseTimer);
        controller.abort();
        cancellations.delete(job.id);
    }
}
function phaseProgress(phase: IngestPhase, detail?: Record<string, unknown>) {
    const n = (key: string) => typeof detail?.[key] === 'number' ? detail[key] as number : undefined;
    return { ...Object.fromEntries(['crawlLimit', 'actionsTotal', 'actionsCompleted'].filter(key => n(key) !== undefined).map(key => [key, n(key)])), ...(n('pages') !== undefined ? { pages: n('pages') } : {}), ...(n('skipped') !== undefined ? { pagesSkipped: n('skipped') } : {}), ...(n('discoveredActions') !== undefined ? { actionsDiscovered: n('discoveredActions') } : {}), ...(n('actions') !== undefined ? { actionsDiscovered: n('actions') } : {}), ...(n('chunks') !== undefined ? { chunks: n('chunks') } : {}), ...(n('embedded') !== undefined ? { embeddingsCompleted: n('embedded') } : {}) };
}
async function tick() { if (stopping)
    return; await reclaimStale(); while (!stopping && active < config.knowledgeWorker.concurrency) {
    const job = await claimOne();
    if (!job)
        break;
    active++;
    void run(job).finally(() => { active--; });
} }
export function startKnowledgeBuildWorker() { if (!hasDatabase || timer) return; stopping = false; void tick().catch((e) => console.error('[knowledge-worker] tick failed', safeMessage(e))); timer = setInterval(() => { void tick().catch((e) => console.error('[knowledge-worker] tick failed', safeMessage(e))); }, config.knowledgeWorker.pollMs); }
export function stopKnowledgeBuildWorker() { stopping = true; for (const controller of cancellations.values())
    controller.abort(Error("Worker stopping")); if (timer)
    clearInterval(timer); timer = null; }
