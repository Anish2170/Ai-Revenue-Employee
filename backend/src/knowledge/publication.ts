import type { KnowledgeSnapshot } from '../context/types.js';
import { config } from '../config/index.js';
import { prisma } from '../db/prisma.js';
import type { StoredArtifact } from '../vectorstore/snapshotStorage.js';
import { readBuildConfiguration, scopeDigest, validateScopeDocuments } from './crawlScope.js';
export class LeaseLostError extends Error {
    constructor() { super('Knowledge build lease lost.'); this.name = 'LeaseLostError'; }
}
export function validateKnowledgeSnapshot(snapshot: KnowledgeSnapshot, allowPartial = false): void {
    if (snapshot.version !== 1 || snapshot.embeddingModel !== config.gemini.embeddingModel)
        throw Error('Unsupported schema or embedding model.');
    if (snapshot.scopeApproval) validateScopeDocuments(snapshot, snapshot.scopeApproval);
    if (!allowPartial && (!snapshot.documents.length || !snapshot.scopeApproval && (snapshot.publication?.completeness === 'partial' || snapshot.crawlManifest?.completeWithinScope === false)))
        throw Error('Incomplete knowledge snapshot.');
    const ids = new Set<string>();
    for (const doc of snapshot.documents) {
        if (ids.has(doc.id) || doc.embedding.length > 8192 || !doc.embedding.length || doc.embedding.length !== snapshot.dimensions || doc.embedding.some(n => !Number.isFinite(n)) || !doc.embedding.some(n => n !== 0))
            throw Error('Invalid vectors or duplicate chunk identity.');
        ids.add(doc.id);
    }
}
export interface BuildFence {
    id: string;
    websiteId: string;
    organizationId: string;
    lockedBy: string | null;
    attempt: number;
    sourceUrl?: string | null;
}
/** DB READY pointer and job completion move in one transaction under the lease.
 * Upload precedes this call; stale workers can leave only inactive artifacts. */
export async function publishKnowledgeBuild(job: BuildFence, snapshotId: string, artifact: StoredArtifact, snapshot: KnowledgeSnapshot) {
    validateKnowledgeSnapshot(snapshot);
    if (job.sourceUrl && job.sourceUrl !== snapshot.sourceUrl)
        throw new LeaseLostError();
    return prisma.$transaction(async (tx) => {
        const website = await tx.$queryRaw<Array<{
            id: string;
            url: string;
            updatedAt: Date;
        }>> `SELECT "id", "url", "updatedAt" FROM "Website" WHERE "id" = ${job.websiteId}::uuid AND "organizationId" = ${job.organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
        if (!website.length)
            throw new LeaseLostError();
        const organization = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Organization" WHERE "id" = ${job.organizationId}::uuid AND "deletedAt" IS NULL FOR SHARE`;
        if (!organization.length)
            throw new LeaseLostError();
        if (new URL(website[0].url).origin !== new URL(snapshot.sourceUrl).origin)
            throw new LeaseLostError();
        // Acquire publication row locks before taking the lease/approval clock.
        // A lock wait must not reuse a timestamp from before the lease expired.
        await tx.$queryRaw`SELECT "id" FROM "KnowledgeBuild" WHERE "id" = ${job.id}::uuid FOR UPDATE`;
        const current = await tx.knowledgeBuild.findFirst({ where: { id: job.id, websiteId: job.websiteId, organizationId: job.organizationId, status: 'RUNNING', lockedBy: job.lockedBy, attempt: job.attempt, snapshotId } });
        if (!current)
            throw new LeaseLostError();
        const configuration = readBuildConfiguration(current.configuration);
        if (snapshot.scopeApproval || configuration?.approval) {
            const approval = configuration?.approval;
            if (!approval || !snapshot.scopeApproval || scopeDigest(approval) !== scopeDigest(snapshot.scopeApproval) || approval.organizationId !== job.organizationId || approval.websiteId !== job.websiteId || approval.configuredWebsiteUrl !== website[0].url || approval.configuredWebsiteRevision !== website[0].updatedAt.toISOString()) throw new LeaseLostError();
            const members = await tx.$queryRaw<Array<{ role: string }>>`SELECT m."role" FROM "OrganizationMember" m JOIN "User" u ON u."id" = m."userId" JOIN "Organization" o ON o."id" = m."organizationId" WHERE m."organizationId" = ${job.organizationId}::uuid AND m."userId" = ${approval.approvedByUserId}::uuid AND u."deletedAt" IS NULL AND o."deletedAt" IS NULL FOR SHARE OF m, u, o`;
            if (members[0]?.role !== 'OWNER') throw new LeaseLostError();
        }
        await tx.$queryRaw`SELECT "id" FROM "KnowledgeSnapshot" WHERE "id" = ${snapshotId}::uuid FOR UPDATE`;
        const now = new Date();
        if (!current.leaseExpiresAt || current.leaseExpiresAt <= now || configuration?.approval && Date.parse(configuration.approval.expiresAt) <= now.getTime())
            throw new LeaseLostError();
        // Atomic conditional update is also the fence if lease reclamation races.
        const changed = await tx.knowledgeBuild.updateMany({ where: { id: job.id, status: 'RUNNING', lockedBy: job.lockedBy, attempt: job.attempt, leaseExpiresAt: { gt: now }, snapshotId }, data: { status: 'SUCCESS', currentPhase: 'complete', pages: snapshot.pages.length, chunks: snapshot.documents.length, embeddingsCompleted: snapshot.documents.length, finishedAt: now, lockedBy: null, leaseExpiresAt: null, error: null, lastErrorCode: null } });
        if (changed.count !== 1)
            throw new LeaseLostError();
        const row = await tx.knowledgeSnapshot.updateMany({ where: { id: snapshotId, websiteId: job.websiteId, organizationId: job.organizationId, status: 'BUILDING' }, data: { status: 'READY', embeddingModel: snapshot.embeddingModel, dimensions: snapshot.dimensions, pagesCrawled: snapshot.pages.length, chunkCount: snapshot.documents.length, sourceUrl: snapshot.sourceUrl, storageProvider: artifact.provider, storageKey: artifact.storageKey, contentSha256: artifact.contentSha256, contentBytes: artifact.contentBytes, etag: artifact.etag, error: null } });
        if (row.count !== 1)
            throw new LeaseLostError();
    });
}
