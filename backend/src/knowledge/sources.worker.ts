import { randomUUID } from 'node:crypto';
import type { KnowledgeSource } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { config, hasDatabase } from '../config/index.js';
import { crawl } from '../crawler/crawler.js';
import { buildChunks } from '../chunking/chunker.js';
import { embedChunks } from '../embeddings/embedder.js';
import type { EmbeddedChunk } from '../context/types.js';
import { getBaseWebsiteStore } from '../vectorstore/registry.js';
import { contentHash, sourceChunks, ensurePageSource, jsonChunks, MAX_CONTENT_CHARS, SourceError } from './sources.service.js';

export interface SourceBuildDependencies { crawl?: typeof crawl; embed?: typeof embedChunks; pdfText?: (bytes: Buffer) => Promise<string> }
async function pdfText(bytes: Buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes), isEvalSupported: false });
  try {
    const info = await parser.getInfo();
    if (info.total > 150) throw new SourceError('PDF exceeds 150 pages. Split it into smaller files.');
    const result = await parser.getText();
    if (!result.pages.some(page => page.text.trim().length > 2)) throw new SourceError('This PDF has no selectable text. Upload a searchable PDF or paste its text.');
    return result.pages.map(page => page.text).join('\n\n');
  } finally { await parser.destroy(); }
}
export async function buildSourceVersion(source: KnowledgeSource, language: string, signal: AbortSignal, deps: SourceBuildDependencies = {}) {
  let content = source.pendingContent ?? source.content;
  let chunks;
  if (source.kind === 'PAGE') {
    const result = await (deps.crawl ?? crawl)(source.url!, { singlePage: true, maxPages: 1, maxRenderedPages: 0,
      maxDurationMs: 45000, knownUrls: [source.url!], signal });
    const page = result.pages[0];
    if (!page || !result.manifest.completeWithinScope) throw new SourceError(`Page was not indexed: ${result.manifest.entries.find(entry => entry.url === source.url)?.reason ?? result.manifest.limits.join(', ')}. Previous content retained.`);
    content = page.text;
    const prepared = buildChunks([{ ...page, url: source.url!, path: new URL(source.url!).pathname }], language);
    if (!prepared.chunks.length || prepared.omitted.some(item => item.reason !== 'low_value')) throw new SourceError('Page contains content that cannot be indexed completely. Previous content retained.');
    chunks = prepared.chunks.map((chunk, index) => ({ ...chunk, id: `source:${source.id}:${index}:${chunk.hash.slice(0, 16)}`, knowledgeSourceId: source.id, sourceKind: 'PAGE' as const }));
  } else {
    if (source.pendingFile) {
      const bytes = Buffer.from(source.pendingFile, 'base64');
      content = /\.pdf$/i.test(source.fileName ?? '') ? await (deps.pdfText ?? pdfText)(bytes) : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (content.includes('\0')) throw new SourceError('The uploaded file contains binary data. Use a UTF-8 text file or PDF.');
    }
    chunks = sourceChunks(content, source, language);
  }
  if (content.length > MAX_CONTENT_CHARS) throw new SourceError('Extracted text exceeds 200,000 characters. Split this source into smaller files.');
  signal.throwIfAborted();
  const hash = contentHash(content);
  const old = Array.isArray(source.chunks) && source.embeddingModel === config.gemini.embeddingModel ? source.chunks as unknown as EmbeddedChunk[] : [];
  const previous = new Map(old.map(chunk => [`${chunk.hash}|${chunk.heading}|${chunk.language}`, chunk.embedding]));
  const key = (chunk: typeof chunks[number]) => `${chunk.hash}|${chunk.heading}|${chunk.language}`;
  const missing = chunks.filter(chunk => !previous.has(key(chunk)));
  const generated = await (deps.embed ?? embedChunks)(missing, { signal, deadlineAt: Date.now() + 60000 });
  if (generated.length !== missing.length) throw new SourceError('Embedding did not complete; previous content retained.');
  const vectors = new Map(generated.map(chunk => [chunk.id, chunk.embedding]));
  const embedded = chunks.map(chunk => ({ ...chunk, embedding: previous.get(key(chunk)) ?? vectors.get(chunk.id) ?? [] }));
  const dimensions = embedded[0]?.embedding.length;
  if (!dimensions || embedded.some(chunk => chunk.embedding.length !== dimensions || chunk.embedding.some(n => !Number.isFinite(n)) || !chunk.embedding.some(n => n !== 0))) throw new SourceError('Invalid embedding vectors; previous content retained.');
  return { content, contentHash: hash, chunks: embedded, embeddingsReused: chunks.length - missing.length };
}

let timer: NodeJS.Timeout | undefined, running = false, stopped = true, lastSchedule = 0;
const activeControllers = new Set<AbortController>();
export async function scheduleSources() {
  if (Date.now() - lastSchedule < 60000) return;
  lastSchedule = Date.now();
  const websites = await prisma.website.findMany({ where: { deletedAt: null, organization: { deletedAt: null }, knowledgeRefreshHours: { gt: 0 } } });
  for (const site of websites) {
    const base = await getBaseWebsiteStore(site.id);
    if (base.meta && new URL(base.meta.sourceUrl).origin === new URL(site.url).origin)
      for (const page of base.meta.pages) await ensurePageSource(site.organizationId, site.id, page.url);
    await prisma.knowledgeSource.updateMany({ where: { websiteId: site.id, organizationId: site.organizationId, origin: new URL(site.url).origin,
      kind: 'PAGE', enabled: true, deletedAt: null, status: { in: ['READY', 'FAILED'] }, nextCheckAt: { lte: new Date() } },
      data: { status: 'QUEUED', error: null, revision: { increment: 1 } } });
  }
}
export async function processOneSource(deps: SourceBuildDependencies = {}) {
  const now = new Date();
  // A stopped worker cannot publish after another worker reclaims the source.
  await prisma.knowledgeSource.updateMany({ where: { status: 'RUNNING', leaseExpiresAt: { lt: now } },
    data: { status: 'QUEUED', leaseToken: null, leaseExpiresAt: null } });
  const candidate = await prisma.knowledgeSource.findFirst({ where: { status: 'QUEUED', deletedAt: null, nextCheckAt: { lte: now },
    website: { deletedAt: null, organization: { deletedAt: null } } }, orderBy: { nextCheckAt: 'asc' } });
  if (!candidate) return false;
  const leaseToken = randomUUID(), controller = new AbortController();
  activeControllers.add(controller);
  const fence = { id: candidate.id, revision: candidate.revision, status: 'RUNNING', leaseToken };
  const claimed = await prisma.knowledgeSource.updateMany({ where: { id: candidate.id, status: 'QUEUED', revision: candidate.revision },
    data: { status: 'RUNNING', leaseToken, leaseExpiresAt: new Date(Date.now() + 120000) } });
  if (!claimed.count) { activeControllers.delete(controller); return true; }
  const heartbeat = setInterval(() => { void prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "KnowledgeSource" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
    return tx.knowledgeSource.updateMany({ where: { ...fence, leaseExpiresAt: { gt: new Date() } }, data: { leaseExpiresAt: new Date(Date.now() + 120000) } });
  }).then(result => { if (!result.count) controller.abort(); }).catch(() => controller.abort()); }, 20000);
  let intervalHours = 24;
  try {
    const site = await prisma.website.findFirstOrThrow({ where: { id: candidate.websiteId, organizationId: candidate.organizationId, deletedAt: null, organization: { deletedAt: null } } });
    intervalHours = site.knowledgeRefreshHours || 24;
    if (new URL(site.url).origin !== candidate.origin) throw new SourceError('Website origin changed. Add this source to the current website again.');
    const result = await buildSourceVersion(candidate, site.primaryLanguage, controller.signal, deps);
    controller.signal.throwIfAborted();
    await prisma.$transaction(async tx => {
      // Serialize with website deletion/origin changes and normal publication.
      await tx.$queryRaw`SELECT "id" FROM "Website" WHERE "id" = ${candidate.websiteId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "KnowledgeSource" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`;
      const currentSite = await tx.website.findFirst({ where: { id: candidate.websiteId, organizationId: candidate.organizationId, deletedAt: null, organization: { deletedAt: null } } });
      if (!currentSite || new URL(currentSite.url).origin !== candidate.origin) throw new SourceError('Website changed during processing.');
      await tx.knowledgeSource.updateMany({ where: { ...fence, deletedAt: null, leaseExpiresAt: { gt: new Date() } }, data: {
        content: result.content, contentHash: result.contentHash, chunks: jsonChunks(result.chunks), embeddingModel: config.gemini.embeddingModel,
        status: 'READY', error: null, pendingContent: null, pendingFile: null, leaseToken: null, leaseExpiresAt: null,
        checkedAt: new Date(), publishedAt: result.contentHash === candidate.contentHash ? candidate.publishedAt ?? new Date() : new Date(),
        nextCheckAt: new Date(Date.now() + intervalHours * 3600000),
      } });
    });
  } catch (error) {
    await prisma.knowledgeSource.updateMany({ where: { ...fence, leaseExpiresAt: { gt: new Date() } }, data: { status: 'FAILED',
      error: error instanceof SourceError ? error.message.slice(0, 500) : 'Source processing failed. Retry this source; its previous published content is retained.',
      checkedAt: new Date(), nextCheckAt: new Date(Date.now() + intervalHours * 3600000), leaseToken: null, leaseExpiresAt: null } });
  } finally { clearInterval(heartbeat); controller.abort(); activeControllers.delete(controller); }
  return true;
}
export function startSourceWorker() {
  if (!hasDatabase || timer) return;
  stopped = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await scheduleSources(); if (!stopped) await processOneSource(); }
    catch { console.warn('[knowledge-sources] Worker check failed; pending work remains durable.'); }
    finally { running = false; }
  };
  timer = setInterval(() => { void tick(); }, 2000);
  void tick();
}
export function stopSourceWorker() { stopped = true; if (timer) clearInterval(timer); timer = undefined; for (const controller of activeControllers) controller.abort(); }
