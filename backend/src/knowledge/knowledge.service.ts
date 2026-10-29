/** Durable PostgreSQL queue and status operations for knowledge builds. */
import { Prisma } from '@prisma/client';
import { config } from '../config/index.js';
import { prisma } from '../db/prisma.js';
import { getWebsiteStore } from '../vectorstore/registry.js';
import { loadSnapshotArtifact } from '../vectorstore/snapshotStorage.js';
import type { CrawlManifest } from '../crawler/crawlManifest.js';
import { randomUUID } from 'node:crypto';
import { createScopeApproval, defaultCrawlBudget, makeScopeReview, readBuildConfiguration, scopeDigest, ScopeError, type BuildConfiguration, type CrawlBudget, type ScopeReviewInput } from './crawlScope.js';
import { snapshotSha256, getSnapshotStorage } from '../vectorstore/snapshotStorage.js';

const ACTIVE = ['QUEUED', 'RUNNING', 'RETRY_WAIT'] as const;

export type KnowledgeBuildStatus = 'QUEUED' | 'RUNNING' | 'RETRY_WAIT' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

function reuseActiveBuild(build: Awaited<ReturnType<typeof prisma.knowledgeBuild.findUniqueOrThrow>>, sourceUrl: string, budget?: CrawlBudget) {
  const configuration = readBuildConfiguration(build.configuration);
  if (configuration?.approval || build.sourceUrl !== sourceUrl || scopeDigest(configuration?.budget ?? defaultCrawlBudget()) !== scopeDigest(budget ?? defaultCrawlBudget()))
    throw new ScopeError('Another build is active with a different scope or budget. Wait for it or cancel it before starting a new build.');
  return { build, created: false };
}

export async function enqueueBuild(
  organizationId: string, websiteId: string, sourceUrl: string, userId: string, language?: string, idempotencyKey?: string,
  budget?: CrawlBudget,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      // This serializes enqueue attempts for this website across all web instances.
      await tx.$queryRaw`SELECT "id" FROM "Website" WHERE "id" = ${websiteId}::uuid FOR UPDATE`;
      const website = await tx.website.findFirst({ where: { id: websiteId, organizationId, deletedAt: null } });
      if (!website || new URL(website.url).origin !== new URL(sourceUrl).origin) throw new ScopeError('Configured website changed. Reload before building.');
      const active = await tx.knowledgeBuild.findFirst({
        where: { websiteId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: 'desc' },
      });
      if (active) return reuseActiveBuild(active, sourceUrl, budget);

      const snapshot = await tx.knowledgeSnapshot.create({
        data: {
          id: randomUUID(), websiteId, organizationId, sourceUrl,
          embeddingModel: config.gemini.embeddingModel, dimensions: 0, pagesCrawled: 0, chunkCount: 0,
          status: 'BUILDING', storageProvider: config.knowledgeStorage === 'r2' ? 'R2' : 'LOCAL', storageKey: '',
        },
      });
      const build = await tx.knowledgeBuild.create({
        data: { websiteId, organizationId, snapshotId: snapshot.id, status: 'QUEUED', currentPhase: 'queued', requestedByUserId: userId, sourceUrl, language: language ?? null, idempotencyKey: idempotencyKey ?? null, maxAttempts: 3, configuration: { version: 1, budget: budget ?? defaultCrawlBudget() } },
      });
      return { build, created: true };
    });
  } catch (error) {
    // The partial unique index is the final race guard if an enqueue arrives outside the row lock.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const active = await prisma.knowledgeBuild.findFirst({ where: { websiteId, status: { in: [...ACTIVE] } }, orderBy: { createdAt: 'desc' } });
      if (active) return reuseActiveBuild(active, sourceUrl, budget);
    }
    throw error;
  }
}

function publicBuild(build: Awaited<ReturnType<typeof prisma.knowledgeBuild.findUniqueOrThrow>>) {
  let configuration: BuildConfiguration | null = null;
  let configurationError: string | null = null;
  try { configuration = readBuildConfiguration(build.configuration) ?? null; }
  catch { configurationError = 'Stored crawl configuration is invalid. Start a new build and review.'; }
  return {
    id: build.id, status: build.status, phase: build.currentPhase,
    progress: { pages: build.pages, pagesSkipped: build.pagesSkipped, actionsDiscovered: build.actionsDiscovered, chunks: build.chunks, embeddingsCompleted: build.embeddingsCompleted, crawlLimit: build.crawlLimit, actionsTotal: build.actionsTotal, actionsCompleted: build.actionsCompleted },
    attempt: build.attempt, maxAttempts: build.maxAttempts, error: build.error ? (build.lastErrorCode==='PARTIAL_CRAWL'?'Crawl incomplete; previous usable knowledge retained.':'Build did not complete; previous usable knowledge retained.') : null, errorCode:build.lastErrorCode,
    startedAt: build.startedAt, finishedAt: build.finishedAt, createdAt: build.createdAt,
    configuration, configurationError,
  };
}

export function summarizeManifest(manifest:CrawlManifest){return {scope:manifest.scope,completeWithinScope:manifest.completeWithinScope,maxPages:manifest.maxPages,maxRenderedPages:manifest.maxRenderedPages??3,discovered:manifest.discovered,attempted:manifest.attempted,fetched:manifest.fetched,useful:manifest.useful,rendered:manifest.rendered,duplicates:manifest.duplicates,failed:manifest.failed,skipped:manifest.skipped,networkRequests:manifest.networkRequests,limits:manifest.limits,missingCategories:[...new Set([...manifest.discoveredCategoriesNotFetched,...manifest.entries.filter(entry=>!['fetched','duplicate'].includes(entry.state)&&entry.reason!=='outside_html_scope').map(entry=>entry.category)])]};}
export async function getBuildManifest(organizationId:string,websiteId:string,buildId:string){
 const build=await prisma.knowledgeBuild.findFirst({where:{id:buildId,organizationId,websiteId}});if(!build?.snapshotId)return null;
 const row=await prisma.knowledgeSnapshot.findFirst({where:{id:build.snapshotId,organizationId,websiteId}});if(!row?.storageKey)return null;
 const snapshot=await loadSnapshotArtifact({provider:row.storageProvider,storageKey:row.storageKey,contentSha256:row.contentSha256}).catch(()=>null);
 return snapshot?.crawlManifest??null;
}
export async function getBuildStatus(organizationId:string,websiteId:string,buildId:string){
 const build=await prisma.knowledgeBuild.findFirst({where:{id:buildId,organizationId,websiteId}});if(!build)return null;
 const manifest=await getBuildManifest(organizationId,websiteId,buildId);return {...publicBuild(build),coverage:manifest?summarizeManifest(manifest):null};
}
/** Active version is the readable published snapshot, not merely the newest row. */
export async function getKnowledgeStatus(websiteId:string){
 const [{store,meta},latestBuild]=await Promise.all([getWebsiteStore(websiteId),prisma.knowledgeBuild.findFirst({where:{websiteId},orderBy:{createdAt:'desc'}})]);
 const manifest=latestBuild?await getBuildManifest(latestBuild.organizationId,websiteId,latestBuild.id):null;
 const publishedBuild=meta?.activeVersion&&meta.activeVersion!=='legacy'?await prisma.knowledgeBuild.findFirst({where:{websiteId,snapshotId:meta.activeVersion,status:'SUCCESS'},orderBy:{finishedAt:'desc'}}):null;
 return {hasKnowledge:store.size()>0,snapshot:meta?{id:meta.activeVersion??'legacy',pagesCrawled:meta.pages.length,chunkCount:store.size(),sourceUrl:meta.sourceUrl,embeddingModel:meta.embeddingModel,dimensions:store.dimensions(),createdAt:meta.createdAt,lastSuccessfulPublish:publishedBuild?.finishedAt??meta.publication?.completedAt??meta.createdAt,changes:meta.publication,scopeApproval:meta.scopeApproval??null,coverage:meta.crawlManifest?summarizeManifest(meta.crawlManifest):null}:null,lastBuild:latestBuild?{...publicBuild(latestBuild),coverage:manifest?summarizeManifest(manifest):null}:null};
}
export async function cancelBuild(organizationId:string,websiteId:string,buildId:string){return prisma.knowledgeBuild.updateMany({where:{id:buildId,organizationId,websiteId,status:{in:[...ACTIVE]}},data:{status:'CANCELLED',currentPhase:'cancelled',finishedAt:new Date(),lockedBy:null,leaseExpiresAt:null}});}

export async function listBuilds(websiteId: string, limit = 10) {
  const builds = await prisma.knowledgeBuild.findMany({ where: { websiteId }, orderBy: { createdAt: 'desc' }, take: limit });
  return builds.map(publicBuild);
}

async function reviewInput(organizationId: string, websiteId: string, buildId: string, db: Pick<typeof prisma, 'website' | 'knowledgeBuild' | 'knowledgeSnapshot'> = prisma): Promise<ScopeReviewInput> {
  const website = await db.website.findFirst({ where: { id: websiteId, organizationId, deletedAt: null } });
  const latest = await db.knowledgeBuild.findFirst({ where: { websiteId, organizationId }, orderBy: { createdAt: 'desc' } });
  if (!website || !latest || latest.id !== buildId || !['FAILED', 'CANCELLED', 'SUCCESS'].includes(latest.status) || !latest.snapshotId) throw new ScopeError('Review the latest finished build.');
  const row = await db.knowledgeSnapshot.findFirst({ where: { id: latest.snapshotId, websiteId, organizationId } });
  if (!row?.storageKey || !row.contentSha256 || !latest.sourceUrl || new URL(latest.sourceUrl).origin !== new URL(website.url).origin) throw new ScopeError('Verified crawl details are unavailable or website origin changed.');
  const artifact = await getSnapshotStorage(row.storageProvider).read(row.storageKey);
  if (!artifact || snapshotSha256(artifact.bytes) !== row.contentSha256) throw new ScopeError('Crawl artifact integrity check failed.');
  const snapshot = JSON.parse(artifact.bytes.toString('utf8'));
  if (!snapshot.crawlManifest || snapshot.publication?.id !== row.id || snapshot.sourceUrl !== latest.sourceUrl) throw new ScopeError('Invalid review artifact identity.');
  const { meta } = await getWebsiteStore(websiteId);
  return { organizationId, websiteId, configuredWebsiteUrl: website.url, configuredWebsiteRevision: website.updatedAt.toISOString(), sourceUrl: latest.sourceUrl, buildId, artifactSha256: row.contentSha256,
    activeVersion: meta?.activeVersion ?? null, previousUrls: [...new Set([...(meta?.pages.map(page => page.url) ?? []), ...(meta?.crawlManifest?.entries.filter(entry => ['fetched', 'duplicate'].includes(entry.state)).map(entry => entry.url) ?? [])])].sort(), manifest: snapshot.crawlManifest };
}
export async function getScopeReview(organizationId: string, websiteId: string, buildId: string) {
  return makeScopeReview(await reviewInput(organizationId, websiteId, buildId));
}
export async function enqueueReviewedBuild(organizationId: string, websiteId: string, buildId: string, userId: string,
  request: Parameters<typeof createScopeApproval>[1]) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Website" WHERE "id" = ${websiteId}::uuid AND "organizationId" = ${organizationId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
    // Membership is checked again under a lock, including after an organization change.
    const members = await tx.$queryRaw<Array<{ role: string }>>`SELECT m."role" FROM "OrganizationMember" m JOIN "User" u ON u."id" = m."userId" JOIN "Organization" o ON o."id" = m."organizationId" WHERE m."organizationId" = ${organizationId}::uuid AND m."userId" = ${userId}::uuid AND u."deletedAt" IS NULL AND o."deletedAt" IS NULL FOR SHARE OF m, u, o`;
    if (members[0]?.role !== 'OWNER') throw new ScopeError('Only a current organization owner may approve a limited scope.', 403);
    const input = await reviewInput(organizationId, websiteId, buildId, tx);
    const approval = createScopeApproval(input, request, userId);
    const configuration: BuildConfiguration = { version: 1, budget: approval.budget, approval };
    const snapshot = await tx.knowledgeSnapshot.create({ data: { id: randomUUID(), websiteId, organizationId, sourceUrl: input.sourceUrl,
      embeddingModel: config.gemini.embeddingModel, dimensions: 0, pagesCrawled: 0, chunkCount: 0, status: 'BUILDING', storageProvider: config.knowledgeStorage === 'r2' ? 'R2' : 'LOCAL', storageKey: '' } });
    const build = await tx.knowledgeBuild.create({ data: { websiteId, organizationId, snapshotId: snapshot.id, status: 'QUEUED', currentPhase: 'queued', requestedByUserId: userId, sourceUrl: input.sourceUrl,
      maxAttempts: 1, configuration: configuration as unknown as Prisma.InputJsonValue } });
    // This audit is mandatory and in the same transaction as the new job.
    await tx.auditLog.create({ data: { organizationId, userId, action: 'knowledge.scope_approved', targetType: 'knowledge_build', targetId: build.id,
      metadata: { scopeHash: approval.hash, reviewedBuildId: buildId, reviewHash: approval.reviewHash, excludedUrls: request.excludedUrls, reason: approval.reason } } });
    return { build, created: true };
  }, { timeout: 30_000 });
}
