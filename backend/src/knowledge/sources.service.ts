import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type KnowledgeSource } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { config } from '../config/index.js';
import { getBaseWebsiteStore, getWebsiteStore } from '../vectorstore/registry.js';
import { normalizeUrl, classifyPage, isCrawlablePath } from '../crawler/links.js';
import { parseAndValidateUrl } from '../security/ssrf.js';
import { findSourceConflicts } from '../context/retrievalSelection.js';
import { planRetrieval } from '../context/retrievalPlan.js';
import type { Chunk, EmbeddedChunk } from '../context/types.js';
import { sourceVersionIsCurrent } from './sourceComposition.js';

export class SourceError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const contentHash = (content: string) => createHash('sha256').update(content).digest('hex');
export const sourceKey = (url: string) => `page:${contentHash(url)}`;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CONTENT_CHARS = 200_000;

export function validateSourceUrl(input: string, websiteUrl: string) {
  parseAndValidateUrl(input);
  const url = normalizeUrl(input);
  if (!url || new URL(url).origin !== new URL(websiteUrl).origin || !isCrawlablePath(url))
    throw new SourceError('Use a public page URL on this website. Upload PDF files separately.');
  return url;
}
export async function ownedWebsite(organizationId: string, websiteId: string) {
  const site = await prisma.website.findFirst({ where: { id: websiteId, organizationId, deletedAt: null, organization: { deletedAt: null } } });
  if (!site) throw new SourceError('Website not found.', 404);
  return site;
}
export function sourceChunks(content: string, source: Pick<KnowledgeSource, 'id' | 'title' | 'url' | 'kind' | 'origin'>, language: string): Chunk[] {
  if (!content.trim() || content.length > MAX_CONTENT_CHARS) throw new SourceError('Content must contain readable text and stay under 200,000 characters.');
  const url = source.url ?? `${source.origin}/__knowledge/source/${source.id}`;
  const chunks: Chunk[] = [];
  let parts: string[] = [], size = 0;
  const flush = () => {
    if (!parts.length) return;
    const text = parts.join('\n\n');
    chunks.push({ id: `source:${source.id}:${chunks.length}:${contentHash(text).slice(0, 16)}`, url, page: new URL(url).pathname,
      pageType: classifyPage(`${new URL(url).pathname}/${source.title}`), title: source.title, heading: source.title,
      section: 'uploaded-knowledge', language, content: text, hash: contentHash(text), lastCrawled: new Date().toISOString(),
      knowledgeSourceId: source.id, sourceKind: source.kind as 'PAGE' | 'TEXT' | 'FILE' });
    parts = []; size = 0;
  };
  for (const paragraph of content.split(/\n\s*\n/u).map(value => value.trim()).filter(Boolean)) {
    if (paragraph.length > 8000) throw new SourceError('A content section exceeds 8,000 characters. Split it into paragraphs before saving.');
    if (size + paragraph.length + 2 > 6000) flush();
    parts.push(paragraph); size += paragraph.length + 2;
  }
  flush();
  return chunks;
}

export async function ensurePageSource(organizationId: string, websiteId: string, input: string) {
  const website = await ownedWebsite(organizationId, websiteId);
  const url = validateSourceUrl(input, website.url), origin = new URL(website.url).origin, key = sourceKey(url);
  return prisma.knowledgeSource.upsert({ where: { websiteId_origin_key: { websiteId, origin, key } }, update: {},
    create: { organizationId, websiteId, origin, key, kind: 'PAGE', url, title: new URL(url).pathname || website.name } });
}
export async function queueSource(organizationId: string, websiteId: string, sourceId: string, pendingContent?: string) {
  const website = await ownedWebsite(organizationId, websiteId);
  const row = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, organizationId, websiteId, origin: new URL(website.url).origin } });
  if (!row) throw new SourceError('Source not found.', 404);
  if (row.deletedAt) throw new SourceError('Restore this source before refreshing it.');
  if (row.kind === 'PAGE' && pendingContent !== undefined) throw new SourceError('Refresh website pages from their URL. Add corrections as a custom note.');
  if (row.kind === 'FILE' && pendingContent === undefined && !row.content && !row.pendingFile) throw new SourceError('Upload this file again to retry extraction.');
  const queued = await prisma.knowledgeSource.updateMany({ where: { id: row.id, organizationId, websiteId, deletedAt: null, revision: row.revision }, data: {
    status: 'QUEUED', error: null, nextCheckAt: new Date(), leaseToken: null, leaseExpiresAt: null, revision: { increment: 1 },
    ...(pendingContent !== undefined ? { pendingContent, pendingFile: null } : {}),
  } });
  if (!queued.count) throw new SourceError('This source changed. Reload it and retry.', 409);
  return { id: row.id, status: 'QUEUED' };
}
export async function addTextSource(organizationId: string, websiteId: string, title: string, content: string) {
  const website = await ownedWebsite(organizationId, websiteId), id = randomUUID();
  const row = await prisma.knowledgeSource.create({ data: { id, organizationId, websiteId, origin: new URL(website.url).origin,
    kind: 'TEXT', key: `text:${id}`, title, status: 'QUEUED', pendingContent: content } });
  return { id: row.id, status: row.status };
}
export function validateUpload(name: string, data: string) {
  if (!/\.(pdf|txt|md|csv|json)$/i.test(name)) throw new SourceError('Supported files: PDF, TXT, MD, CSV and JSON.');
  if (!data || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4) throw new SourceError('Invalid file encoding.');
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) throw new SourceError('Upload a file up to 5 MB.');
  if (/\.pdf$/i.test(name) && bytes.subarray(0, 5).toString() !== '%PDF-') throw new SourceError('The file is not a valid PDF.');
  return bytes;
}
export async function addFileSource(organizationId: string, websiteId: string, name: string, data: string) {
  const website = await ownedWebsite(organizationId, websiteId), bytes = validateUpload(name, data);
  const origin = new URL(website.url).origin, key = `file:${contentHash(bytes.toString('base64'))}`;
  const row = await prisma.knowledgeSource.upsert({ where: { websiteId_origin_key: { websiteId, origin, key } },
    create: { organizationId, websiteId, origin, key, kind: 'FILE', title: name, fileName: name, pendingFile: data, status: 'QUEUED' },
    update: { pendingFile: data, pendingContent: null, status: 'QUEUED', enabled: true, deletedAt: null, error: null,
      leaseToken: null, leaseExpiresAt: null, nextCheckAt: new Date(), revision: { increment: 1 } } });
  return { id: row.id, status: row.status };
}

/** Record publication-independent controls. Tombstones prevent rebuilds from
 * silently resurrecting a source the owner removed. */
export async function setSourcePolicy(organizationId: string, websiteId: string, sourceId: string,
  input: { enabled?: boolean; priority?: number; title?: string; content?: string; restore?: boolean; remove?: boolean }) {
  const website = await ownedWebsite(organizationId, websiteId);
  const origin = new URL(website.url).origin;
  const row = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, organizationId, websiteId, origin } });
  if (!row) throw new SourceError('Source not found.', 404);
  if (input.content !== undefined && row.kind === 'PAGE') throw new SourceError('Refresh website pages from their URL. Add corrections as a custom note.');
  if (input.content !== undefined && row.deletedAt && !input.restore) throw new SourceError('Restore this source before editing it.');
  const reindex = input.content !== undefined || input.title !== undefined && input.title !== row.title && row.kind !== 'PAGE';
  const hasChange = reindex || input.enabled !== undefined || input.priority !== undefined || input.title !== undefined || input.remove || input.restore;
  if (!hasChange) return { updated: true };
  const result = await prisma.knowledgeSource.updateMany({ where: { id: sourceId, organizationId, websiteId, origin, revision: row.revision },
    data: { ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(reindex ? { status: 'QUEUED', pendingContent: input.content ?? row.pendingContent ?? row.content, pendingFile: null,
        error: null, nextCheckAt: new Date(), leaseToken: null, leaseExpiresAt: null, revision: { increment: 1 } } : {}),
      ...(input.remove ? { deletedAt: new Date(), enabled: false, status: 'READY', error: null, pendingFile: null, pendingContent: null, leaseToken: null, leaseExpiresAt: null, revision: { increment: 1 } } : {}),
      ...(input.restore ? { deletedAt: null, enabled: true } : {}) } });
  if (!result.count) throw new SourceError('This source changed. Reload it and retry.', 409);
  return { updated: true, ...(reindex ? { status: 'QUEUED' } : {}) };
}

export async function sourceInventory(organizationId: string, websiteId: string) {
  const website = await ownedWebsite(organizationId, websiteId), origin = new URL(website.url).origin;
  const [base, rows, active] = await Promise.all([getBaseWebsiteStore(websiteId),
    prisma.knowledgeSource.findMany({ where: { organizationId, websiteId, origin }, orderBy: { createdAt: 'asc' } }), getWebsiteStore(websiteId)]);
  const baseValid = base.meta && new URL(base.meta.sourceUrl).origin === origin;
  const documents = baseValid ? base.store.export() : [];
  const urls = new Set(baseValid ? [...base.meta!.pages.map(page => page.url), ...(base.meta!.crawlManifest?.entries.map(entry => entry.url) ?? [])] : []);
  rows.filter(row => row.url).forEach(row => urls.add(row.url!));
  const summarize = (url: string | null, row?: KnowledgeSource) => {
    const useOverlay = row && sourceVersionIsCurrent(row, documents, config.gemini.embeddingModel);
    const docs = useOverlay ? row.chunks as unknown as EmbeddedChunk[] : documents.filter(doc => doc.url === url || doc.sourceAliases?.some(alias => alias.url === url));
    const entry = baseValid ? base.meta!.crawlManifest?.entries.find(entry => entry.url === url) : undefined;
    const text = (useOverlay ? row.content : '') || (baseValid ? base.meta!.debugPages?.find(page => page.url === url)?.cleanedText : '') || docs.map(doc => doc.content).join('\n\n');
    return { id: row?.id ?? null, url, kind: row?.kind ?? 'PAGE', title: row?.title ?? entry?.title ?? docs[0]?.title ?? url ?? '',
      status: row?.deletedAt ? 'REMOVED' : row?.status !== 'READY' && row ? row.status : docs.length ? 'READY' : entry?.state === 'failed' ? 'FAILED' : entry?.state === 'pending' ? 'PARTIAL' : 'SKIPPED',
      reason: row?.error ?? entry?.reason ?? (!docs.length ? 'No indexed content.' : null), enabled: row?.enabled ?? true, priority: row?.priority ?? 0,
      publishedAt: (useOverlay ? row.publishedAt?.toISOString() : docs[0]?.lastCrawled) ?? null, checkedAt: row?.checkedAt?.toISOString() ?? null,
      chunkCount: docs.length, characters: text.length, summary: text.replace(/\s+/gu, ' ').slice(0, 320),
      topics: [...new Set(docs.map(doc => doc.heading))].slice(0, 12), servingPrevious: Boolean(docs.length && row && ['QUEUED', 'RUNNING', 'FAILED'].includes(row.status)) };
  };
  const items = [...[...urls].map(url => summarize(url, rows.find(row => row.url === url))), ...rows.filter(row => !row.url).map(row => summarize(null, row))];
  const hits = active.store.export().map(({ embedding, ...chunk }) => ({ ...chunk, score: 1 }));
  const conflicts = findSourceConflicts(hits, planRetrieval('', hits)).map(conflict => {
    const values = hits.filter(chunk => conflict.sourceIds.includes(chunk.id));
    const maximum = Math.max(...values.map(chunk => chunk.sourcePriority ?? 0));
    const priorities = new Set(values.map(chunk => chunk.sourcePriority ?? 0));
    return { ...conflict, resolvedByPriority: priorities.size > 1 && new Set(values.filter(chunk => (chunk.sourcePriority ?? 0) === maximum).map(chunk => chunk.url)).size === 1 };
  });
  return { items, conflicts, refreshHours: website.knowledgeRefreshHours,
    overview: { total: items.length, ready: items.filter(item => item.status === 'READY' && item.enabled).length, chunks: active.store.size(),
      topics: [...new Set(hits.map(chunk => chunk.heading))].slice(0, 30) } };
}
export async function sourceDetail(organizationId: string, websiteId: string, sourceId: string) {
  const website = await ownedWebsite(organizationId, websiteId);
  const row = await prisma.knowledgeSource.findFirst({ where: { id: sourceId, websiteId, organizationId, origin: new URL(website.url).origin } });
  if (!row) throw new SourceError('Source not found.', 404);
  const base = await getBaseWebsiteStore(websiteId);
  const baseValid = base.meta && new URL(base.meta.sourceUrl).origin === row.origin;
  const useOverlay = sourceVersionIsCurrent(row, baseValid ? base.store.export() : [], config.gemini.embeddingModel);
  const docs = useOverlay ? row.chunks as unknown as EmbeddedChunk[] : baseValid ? base.store.export().filter(doc => doc.url === row.url || doc.sourceAliases?.some(alias => alias.url === row.url)) : [];
  const content = (useOverlay ? row.content : '') || (baseValid ? base.meta!.debugPages?.find(page => page.url === row.url)?.cleanedText : '') || docs.map(doc => doc.content).join('\n\n');
  return { id: row.id, kind: row.kind, title: row.title, url: row.url, content, pendingContent: row.pendingContent, status: row.status,
    enabled: row.enabled, priority: row.priority, error: row.error, publishedAt: row.publishedAt, checkedAt: row.checkedAt,
    chunks: docs.map(({ embedding, ...chunk }) => chunk) };
}
export async function configureSourceRefresh(organizationId: string, websiteId: string, hours: number) {
  const website = await ownedWebsite(organizationId, websiteId);
  await prisma.website.update({ where: { id: website.id }, data: { knowledgeRefreshHours: hours } });
  return { refreshHours: hours };
}
export const jsonChunks = (chunks: EmbeddedChunk[]) => JSON.parse(JSON.stringify(chunks)) as Prisma.InputJsonValue;
