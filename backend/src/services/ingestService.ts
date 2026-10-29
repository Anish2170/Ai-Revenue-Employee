/** One staged ingestion pipeline. A tenant build does not mutate a reader's
 * live store. Only the lease-fenced worker publishes its immutable artifact. */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { crawl, type CrawlResult } from '../crawler/crawler.js';
import { deriveSiteLinks } from '../crawler/links.js';
import { buildChunks } from '../chunking/chunker.js';
import { embedChunks } from '../embeddings/embedder.js';
import { config } from '../config/index.js';
import { getBusinessInstructions } from '../context/instructions.js';
import { MemoryVectorStore } from '../vectorstore/memoryStore.js';
import { loadLatestWebsiteSnapshot, writeSnapshotArtifact, snapshotSha256, type StoredArtifact } from '../vectorstore/snapshotStorage.js';
import { saveSnapshotFile, legacySnapshotPath, websiteSnapshotPath, loadSnapshot } from '../vectorstore/persistence.js';
import { activateLegacySnapshot } from '../vectorstore/index.js';
import { buildActionGraph } from '../business-actions/actionDiscovery.js';
import { generateDecision, llmAvailable } from '../llm/index.js';
import { validateKnowledgeSnapshot } from '../knowledge/publication.js';
import type { KnowledgeSnapshot, Chunk, EmbeddedChunk } from '../context/types.js';
import type { CrawlManifest } from '../crawler/crawlManifest.js';
import { crawlBudgetSchema, scopeDigest, ScopeError, validateApprovedCrawl, validateApprovalIdentity, type CrawlBudget, type ScopeApproval } from '../knowledge/crawlScope.js';
export type IngestPhase = 'crawling' | 'action_discovery' | 'chunking' | 'embedding' | 'indexing' | 'saving';
export interface IngestDependencies {
    crawl?: typeof crawl;
    embed?: typeof embedChunks;
    previous?: () => Promise<KnowledgeSnapshot | null>;
    write?: (snapshot: KnowledgeSnapshot) => Promise<StoredArtifact>;
    actions?: typeof buildActionGraph;
}
export interface IngestOptions {
    crawlBudget?: CrawlBudget;
    scopeApproval?: ScopeApproval;
    websiteId?: string;
    organizationId?: string;
    snapshotId?: string;
    language?: string;
    signal?: AbortSignal;
    assertCurrent?: () => Promise<void>;
    onPhase?: (phase: IngestPhase, detail?: Record<string, unknown>) => void | Promise<void>;
}
export interface IngestResult {
    sourceUrl: string;
    pages: number;
    chunks: number;
    skipped: number;
    dimensions: number;
    snapshotArtifact: StoredArtifact;
    durationMs: number;
    snapshot: KnowledgeSnapshot;
    embeddingsCreated: number;
    embeddingsReused: number;
}
export class IncompleteBuildError extends Error {
    constructor(public manifest: CrawlManifest, public artifact?: StoredArtifact) { super('Crawl incomplete; previous usable knowledge retained. Review crawl limits or failed sources.'); this.name = 'IncompleteBuildError'; }
}
const running = new Set<string>();
export async function ingest(url: string, opts: IngestOptions = {}, deps: IngestDependencies = {}): Promise<IngestResult> {
    const scope = opts.websiteId ?? 'legacy';
    if (running.has(scope))
        throw Error('Knowledge build already running for this website.');
    running.add(scope);
    try {
        if (!deps.embed && !config.gemini.apiKey)
            throw Error('Embedding provider not configured.');
        const started = Date.now(), id = opts.snapshotId ?? randomUUID(), language = opts.language ?? getBusinessInstructions().language;
        const check = async () => { opts.signal?.throwIfAborted(); await opts.assertCurrent?.(); };
        await check();
        if (opts.crawlBudget) crawlBudgetSchema.parse(opts.crawlBudget);
        if (opts.scopeApproval) {
            validateApprovalIdentity(opts.scopeApproval);
            if (opts.scopeApproval.organizationId !== opts.organizationId || opts.scopeApproval.websiteId !== opts.websiteId || opts.scopeApproval.sourceUrl !== url || scopeDigest(opts.scopeApproval.budget) !== scopeDigest(opts.crawlBudget) || Date.parse(opts.scopeApproval.expiresAt) <= Date.now()) throw new ScopeError('Invalid or expired scope approval.');
        }
        const previous = await (deps.previous ?? (async () => opts.websiteId ? (await loadLatestWebsiteSnapshot(opts.websiteId)).snapshot : loadSnapshot()))();
        if (opts.scopeApproval && previous) {
            const required = new Set(opts.scopeApproval.inventory.filter(entry => entry.disposition === 'required').map(entry => entry.url));
            const previousUrls = [...previous.pages.map(page => page.url), ...(previous.crawlManifest?.entries.filter(entry => ['fetched', 'duplicate'].includes(entry.state)).map(entry => entry.url) ?? [])];
            if (previousUrls.some(url => !required.has(url))) throw new ScopeError('Previously published source is missing from approved scope.');
        }
        const write = deps.write ?? (async (snapshot: KnowledgeSnapshot) => {
            if (opts.websiteId) {
                if (!opts.organizationId || !opts.snapshotId)
                    throw Error('Tenant snapshot identity required.');
                return writeSnapshotArtifact({ websiteId: opts.websiteId, organizationId: opts.organizationId, snapshotId: id, snapshot, localKey: join(websiteSnapshotPath(opts.websiteId) + '.versions', id + '.json') });
            }
            const path = await saveSnapshotFile(legacySnapshotPath(), snapshot);
            const bytes = Buffer.from(JSON.stringify(snapshot));
            return { provider: 'LOCAL', storageKey: path, contentBytes: bytes.length, contentSha256: snapshotSha256(bytes), etag: null };
        });
        await opts.onPhase?.('crawling');
        const result = await (deps.crawl ?? crawl)(url, { ...opts.crawlBudget, reviewedSources: opts.scopeApproval?.inventory, signal: opts.signal, knownUrls: previous ? [...new Set([...previous.pages.map(page => page.url), ...(previous.crawlManifest?.entries.filter(entry => ['fetched', 'duplicate'].includes(entry.state)).map(entry => entry.url) ?? [])])] : undefined, onProgress: async (pages, skipped, crawlLimit) => { await check(); await opts.onPhase?.('crawling', { pages, skipped, crawlLimit }); } });
        await check();
        const { pages, skipped, manifest } = result;
        await opts.onPhase?.('crawling', { pages: pages.length, skipped: skipped.length, crawlLimit: manifest.maxPages });
        const { chunks, omitted } = buildChunks(pages, language);
        const count = (url: string) => chunks.filter(c => c.url === url || c.sourceAliases?.some(alias => alias.url === url)).length;
        for (const entry of manifest.entries)
            entry.chunkCount = count(entry.state === 'duplicate' ? entry.canonical ?? entry.url : entry.finalUrl ?? entry.url);
        if (chunks.length > 300 || chunks.reduce((n, chunk) => n + chunk.content.length, 0) > 600000) {
            manifest.completeWithinScope = false;
            manifest.limits.push('chunk_or_text_budget');
        }
        if (!chunks.length || omitted.some(item => item.reason === 'oversized_semantic_unit') || pages.some(page => !count(page.url))) {
            manifest.completeWithinScope = false;
            manifest.limits.push('unindexed_useful_content');
        }
        const pageMeta = pages.map(({ url, path, pageType, contentHash, lastCrawled }) => ({ url, path, pageType, contentHash, lastCrawled }));
        const old = new Map([...(previous?.pages.map(page => [page.url, page.contentHash] as const) ?? []), ...(previous?.crawlManifest?.entries.filter(entry => entry.contentHash).map(entry => [entry.url, entry.contentHash!] as const) ?? [])]);
        const publication = { id, completedAt: new Date().toISOString(), completeness: manifest.completeWithinScope ? 'complete' as const : 'partial' as const, changed: pages.filter(page => old.get(page.url) !== page.contentHash).length, unchanged: pages.filter(page => old.get(page.url) === page.contentHash).length, removed: manifest.entries.filter(entry => entry.state === 'gone' && old.has(entry.url)).length, embeddingsReused: 0 };
        const base: KnowledgeSnapshot = { version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 0, createdAt: new Date().toISOString(), sourceUrl: url, siteLinks: deriveSiteLinks(pages), pages: pageMeta, documents: [], publication, crawlManifest: manifest, debugPages: pages.map(page => ({ url: page.url, path: page.path, title: page.title, crawlStatus: 'crawled', httpStatus: page.httpStatus ?? 200, rawExtractedText: page.text, cleanedText: page.text, extractedTextLength: page.text.length, cleanedTextLength: page.text.length, wordCount: page.text.split(/\s+/).length, chunkCount: count(page.url), lastCrawled: page.lastCrawled, renderer: page.renderer ?? 'unknown', cleaning: { ...(page.cleaning ?? { removedNavigation: false, removedFooter: false, removedScripts: false, removedCookieBanners: false, beforeLength: page.text.length, afterLength: page.text.length }), removedDuplicatedContent: false, notes: ['Flags record actual matching DOM removals; raw pre-clean HTML is not stored. JSON-LD-only claims are not promoted.'] } })) };
        let approvedComplete = false;
        if (opts.scopeApproval) {
            try { validateApprovedCrawl(opts.scopeApproval, manifest); approvedComplete = true; base.scopeApproval = opts.scopeApproval; }
            catch { manifest.limits.push('approved_scope_validation_failed'); }
        }
        if ((!manifest.completeWithinScope && !approvedComplete) || !chunks.length) {
            base.debugPages = [];
            let artifact: StoredArtifact | undefined;
            if (opts.websiteId) {
                await check();
                artifact = await write(base).catch(() => undefined);
            }
            throw new IncompleteBuildError(manifest, artifact);
        }
        await opts.onPhase?.('action_discovery');
        let classificationCalls = 0;
        base.actionGraph = await (deps.actions ?? buildActionGraph)(result.actions.slice(0, 100), { generate: async (req) => { await check(); if (!llmAvailable() || classificationCalls++ >= 6)
                return null; return generateDecision({ ...req, signal: opts.signal, deadlineAt: Date.now() + 6000 }); }, onProgress: async (actionsCompleted, actionsTotal) => { await check(); await opts.onPhase?.('action_discovery', { actionsCompleted, actionsTotal }); } });
        await opts.onPhase?.('chunking', { chunks: chunks.length });
        await check();
        const key = (chunk: Chunk) => `${chunk.url}|${chunk.heading}|${chunk.language}|${chunk.hash}`;
        const reusable = new Map(previous?.embeddingModel === config.gemini.embeddingModel ? previous.documents.map(chunk => [key(chunk), chunk.embedding]) : []);
        const missing = chunks.filter(chunk => !reusable.has(key(chunk)));
        await opts.onPhase?.('embedding', { chunks: chunks.length, embedded: chunks.length - missing.length });
        const generated = await (deps.embed ?? embedChunks)(missing, { signal: opts.signal, deadlineAt: Date.now() + 60000 });
        await check();
        if (generated.length !== missing.length)
            throw Error('Embedding produced incomplete vectors.');
        const generatedMap = new Map(generated.map(chunk => [chunk.id, chunk.embedding]));
        const embedded: EmbeddedChunk[] = chunks.map(chunk => ({ ...chunk, embedding: reusable.get(key(chunk)) ?? generatedMap.get(chunk.id) ?? [] }));
        await opts.onPhase?.('indexing');
        const staged = new MemoryVectorStore();
        await staged.indexDocuments(embedded);
        base.documents = staged.export();
        base.dimensions = staged.dimensions();
        base.publication!.embeddingsReused = chunks.length - missing.length;
        validateKnowledgeSnapshot(base);
        base.createdAt = new Date().toISOString();
        base.publication!.completedAt = base.createdAt;
        await opts.onPhase?.('saving');
        await check();
        const artifact = await write(base);
        await check();
        if (!opts.websiteId)
            activateLegacySnapshot(base);
        return { sourceUrl: url, pages: pages.length, chunks: chunks.length, skipped: skipped.length, dimensions: base.dimensions, snapshotArtifact: artifact, durationMs: Date.now() - started, snapshot: base, embeddingsCreated: missing.length, embeddingsReused: chunks.length - missing.length };
    }
    finally {
        running.delete(scope);
    }
}
