import { loadSnapshotFile, websiteSnapshotPath } from '../vectorstore/persistence.js';
import { retrievalConfig } from '../config/retrieval.js';
import { config } from '../config/index.js';
import { embedQuery } from '../embeddings/embedder.js';
import { MemoryVectorStore } from '../vectorstore/memoryStore.js';
import { chatPromptBuilder } from '../prompts/chatPromptBuilder.js';
import { streamChat } from '../llm/index.js';
import type { BusinessInstructions, EmbeddedChunk, KnowledgeSnapshot, RetrievedChunk } from '../context/types.js';
import type { ChatMessage } from '../types.js';

const PREVIEW_CHARS = 220;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface DebugSessionInput {
  question: string;
  instructions: BusinessInstructions;
  messages?: ChatMessage[];
  conversationSummary?: string;
  conversationMemories?: string[];
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

function pageNumber(page?: number): number {
  if (!page || Number.isNaN(page)) return 1;
  return Math.max(1, Math.floor(page));
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

async function loadWebsiteSnapshot(websiteId: string): Promise<KnowledgeSnapshot | null> {
  return loadSnapshotFile(websiteSnapshotPath(websiteId));
}

function chunksForPage(snapshot: KnowledgeSnapshot, url: string): EmbeddedChunk[] {
  return snapshot.documents.filter((chunk) => chunk.url === url);
}

function pageDebug(snapshot: KnowledgeSnapshot, url: string) {
  const debug = snapshot.debugPages?.find((page) => page.url === url);
  const meta = snapshot.pages.find((page) => page.url === url);
  const chunks = chunksForPage(snapshot, url);
  const text = debug?.cleanedText ?? chunks.map((chunk) => chunk.content).join('\n\n');
  return {
    url,
    path: debug?.path ?? meta?.path ?? new URL(url).pathname,
    title: debug?.title ?? chunks[0]?.title ?? meta?.path ?? url,
    crawlStatus: debug?.crawlStatus ?? 'crawled',
    httpStatus: debug?.httpStatus ?? null,
    wordCount: debug?.wordCount ?? wordCount(text),
    extractedTextLength: debug?.extractedTextLength ?? text.length,
    cleanedTextLength: debug?.cleanedTextLength ?? text.length,
    chunkCount: debug?.chunkCount ?? chunks.length,
    lastCrawled: debug?.lastCrawled ?? meta?.lastCrawled ?? snapshot.createdAt,
    lastEmbedded: snapshot.createdAt,
    renderer: debug?.renderer ?? 'unknown',
    rawExtractedText: debug?.rawExtractedText ?? null,
    cleanedText: debug?.cleanedText ?? text,
    cleaning: debug?.cleaning ?? {
      removedNavigation: false,
      removedFooter: false,
      removedScripts: false,
      removedCookieBanners: false,
      removedDuplicatedContent: false,
      beforeLength: text.length,
      afterLength: text.length,
      notes: ['This snapshot predates persisted cleaning diagnostics; rebuild knowledge to capture exact crawler/cleaning debug data.'],
    },
    debugCaptured: Boolean(debug),
  };
}

function paginate<T>(items: T[], page?: number, limit?: number) {
  const take = clampLimit(limit);
  const current = pageNumber(page);
  const start = (current - 1) * take;
  return {
    items: items.slice(start, start + take),
    pagination: { page: current, limit: take, total: items.length, pages: Math.ceil(items.length / take) || 1 },
  };
}

export async function getOverview(websiteId: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) return { hasSnapshot: false };
  return {
    hasSnapshot: true,
    snapshot: {
      sourceUrl: snapshot.sourceUrl,
      createdAt: snapshot.createdAt,
      embeddingModel: snapshot.embeddingModel,
      dimensions: snapshot.dimensions,
      pages: snapshot.pages.length,
      chunks: snapshot.documents.length,
      debugPagesCaptured: snapshot.debugPages?.length ?? 0,
      retrievalConfig,
    },
  };
}

export async function listPages(websiteId: string, page?: number, limit?: number) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) return { items: [], pagination: { page: 1, limit: clampLimit(limit), total: 0, pages: 1 } };
  const urls = Array.from(new Set([...snapshot.pages.map((p) => p.url), ...(snapshot.debugPages?.map((p) => p.url) ?? [])]));
  const rows = urls.map((url) => {
    const full = pageDebug(snapshot, url);
    const { rawExtractedText: _raw, cleanedText: _cleaned, cleaning: _cleaning, ...row } = full;
    return row;
  });
  return paginate(rows, page, limit);
}

export async function getPageDetail(websiteId: string, url: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) return null;
  return pageDebug(snapshot, url);
}

export async function listChunks(websiteId: string, page?: number, limit?: number, pageUrl?: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) return { items: [], pagination: { page: 1, limit: clampLimit(limit), total: 0, pages: 1 } };
  const docs = pageUrl ? snapshot.documents.filter((chunk) => chunk.url === pageUrl) : snapshot.documents;
  const rows = docs.map((chunk, index) => ({
    number: index + 1,
    id: chunk.id,
    tokenCount: Math.ceil(wordCount(chunk.content) * 1.33),
    characterCount: chunk.content.length,
    embeddingStatus: chunk.embedding?.length ? 'embedded' : 'missing',
    embeddingDimensions: chunk.embedding?.length ?? 0,
    pageUrl: chunk.url,
    pageTitle: chunk.title,
    preview: preview(chunk.content),
  }));
  return paginate(rows, page, limit);
}

export async function getChunkDetail(websiteId: string, chunkId: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) return null;
  const chunk = snapshot.documents.find((doc) => doc.id === chunkId);
  if (!chunk) return null;
  const { embedding: _embedding, ...rest } = chunk;
  return { ...rest, tokenCount: Math.ceil(wordCount(chunk.content) * 1.33), characterCount: chunk.content.length, embeddingStatus: chunk.embedding.length ? 'embedded' : 'missing', embeddingDimensions: chunk.embedding.length };
}

function contextFromRetrieved(instructions: BusinessInstructions, chunks: RetrievedChunk[]) {
  return {
    business: { name: instructions.businessName },
    instructions,
    chunks,
    siteLinks: [] as Array<{ label: string; url: string }>,
    businessActions: [],
    source: 'rag' as const,
    scores: chunks.map((chunk) => Number(chunk.score.toFixed(3))),
  };
}

export async function runSearchTest(websiteId: string, input: DebugSessionInput) {
  const started = Date.now();
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) throw new Error('No knowledge snapshot found for this website.');

  const timings: Record<string, number> = { crawler: 0, cleaning: 0, chunking: 0, embedding: 0, retrieval: 0, promptAssembly: 0, llm: 0, validation: 0, total: 0 };
  const retrievalStart = Date.now();
  const queryEmbedding = await embedQuery(input.question);
  const store = new MemoryVectorStore();
  store.import(snapshot.documents);
  const hits = await store.search(queryEmbedding, 10);
  timings.retrieval = Date.now() - retrievalStart;

  const kept: RetrievedChunk[] = [];
  let charBudget = retrievalConfig.maxContextChars;
  for (const hit of hits.filter((chunk) => chunk.score >= retrievalConfig.similarityThreshold)) {
    if (hit.content.length > charBudget) break;
    charBudget -= hit.content.length;
    kept.push(hit);
  }

  const promptStart = Date.now();
  const messages = input.messages?.length ? input.messages : [{ role: 'user' as const, content: input.question }];
  const conversation = {
    conversationId: 'knowledge-debug',
    summary: input.conversationSummary,
    memories: input.conversationMemories ?? [],
    recentMessages: messages,
  };
  const context = contextFromRetrieved(input.instructions, kept);
  const prompt = chatPromptBuilder.build(context, messages, undefined, undefined, conversation);
  timings.promptAssembly = Date.now() - promptStart;

  let rawGeminiResponse = '';
  let llmError: string | null = null;
  const llmStart = Date.now();
  try {
    const stream = streamChat({ system: prompt.system, messages: prompt.messages, debug: { requestId: `knowledge-debug-${Date.now()}`, pipeline: 'knowledge-debug' } });
    for await (const token of stream) rawGeminiResponse += token;
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err);
  }
  timings.llm = Date.now() - llmStart;
  timings.total = Date.now() - started;

  return {
    query: input.question,
    retrievedChunks: hits.map((chunk) => ({
      similarityScore: Number(chunk.score.toFixed(6)),
      chunkId: chunk.id,
      pageUrl: chunk.url,
      pageTitle: chunk.title,
      preview: preview(chunk.content),
      fullChunk: chunk.content,
      keptForPrompt: kept.some((keptChunk) => keptChunk.id === chunk.id),
    })),
    finalLlmContext: {
      businessInstructions: input.instructions,
      conversationSummary: input.conversationSummary ?? '',
      conversationMemory: input.conversationMemories ?? [],
      retrievedKnowledge: kept,
      recentMessages: prompt.messages,
      promptInstructions: chatPromptBuilder.version,
      systemPrompt: prompt.system,
      completeAssembledPrompt: JSON.stringify({ provider: `gemini:${config.gemini.model}`, system: prompt.system, messages: prompt.messages }, null, 2),
    },
    rawGeminiResponse,
    llmError,
    timings,
  };
}

export async function listDiscoveredActions(websiteId: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  const graph = snapshot?.actionGraph;
  if (!graph) return { generatedAt: null, items: [] };
  return {
    generatedAt: graph.generatedAt,
    items: graph.nodes.map((node) => ({
      intent: node.intent,
      detectedLabel: node.preferred.label,
      resolvedUrl: node.preferred.url,
      confidence: node.preferred.confidence,
      detectionMethod: node.preferred.detectionMethod,
      rule: node.preferred.rule,
      page: node.preferred.pageUrl,
      whySelected: node.preferred.why,
      alternativeCandidates: node.candidates.slice(1).map((candidate) => ({
        label: candidate.label,
        url: candidate.url,
        confidence: candidate.confidence,
        detectionMethod: candidate.detectionMethod,
        page: candidate.pageUrl,
        why: candidate.why,
      })),
    })),
  };
}

export async function qualityChecks(websiteId: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  if (!snapshot) return [];
  const checks: Array<{ type: string; severity: 'info' | 'warning' | 'danger'; message: string; url?: string; chunkId?: string }> = [];
  const hashToChunks = new Map<string, EmbeddedChunk[]>();

  for (const page of snapshot.pages) {
    const detail = pageDebug(snapshot, page.url);
    if (detail.cleanedTextLength === 0) checks.push({ type: 'zero_content', severity: 'danger', message: 'Page has zero stored content.', url: page.url });
    if (detail.wordCount < 100) checks.push({ type: 'under_100_words', severity: 'warning', message: `Page has ${detail.wordCount} words.`, url: page.url });
    if (detail.httpStatus === 404) checks.push({ type: '404_page', severity: 'danger', message: 'Page returned HTTP 404.', url: page.url });
    if (detail.httpStatus && detail.httpStatus >= 400) checks.push({ type: 'broken_url', severity: 'danger', message: `Page returned HTTP ${detail.httpStatus}.`, url: page.url });
    checks.push({ type: detail.renderer === 'js-rendered' ? 'js_rendered_page' : 'static_page', severity: 'info', message: `Renderer: ${detail.renderer}.`, url: page.url });
  }

  for (const chunk of snapshot.documents) {
    const arr = hashToChunks.get(chunk.hash) ?? [];
    arr.push(chunk);
    hashToChunks.set(chunk.hash, arr);
    if (!chunk.embedding?.length) checks.push({ type: 'no_embedding', severity: 'danger', message: 'Chunk has no embedding.', chunkId: chunk.id, url: chunk.url });
    if (wordCount(chunk.content) > 800) checks.push({ type: 'chunk_larger_than_configured_size', severity: 'warning', message: `Chunk has ${wordCount(chunk.content)} words.`, chunkId: chunk.id, url: chunk.url });
  }

  for (const [hash, chunks] of hashToChunks) {
    if (hash && chunks.length > 1) {
      for (const chunk of chunks) checks.push({ type: 'duplicate_chunk', severity: 'warning', message: `Duplicate chunk hash appears ${chunks.length} times.`, chunkId: chunk.id, url: chunk.url });
    }
  }

  return checks;
}

export async function visualFlow(websiteId: string) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  return [
    { id: 'website', label: 'Website', count: snapshot ? 1 : 0 },
    { id: 'crawler', label: 'Crawler', count: snapshot?.pages.length ?? 0 },
    { id: 'cleaned-text', label: 'Cleaned Text', count: snapshot?.debugPages?.length ?? 0 },
    { id: 'chunks', label: 'Chunks', count: snapshot?.documents.length ?? 0 },
    { id: 'embeddings', label: 'Embeddings', count: snapshot?.documents.filter((doc) => doc.embedding?.length).length ?? 0 },
    { id: 'retrieved-chunks', label: 'Retrieved Chunks', count: 0 },
    { id: 'prompt', label: 'Prompt', count: 0 },
    { id: 'gemini', label: 'Gemini', count: 0 },
    { id: 'answer', label: 'Answer', count: 0 },
  ];
}

export async function exportSession(websiteId: string, format: 'json' | 'markdown' | 'txt', latestSearch?: unknown) {
  const snapshot = await loadWebsiteSnapshot(websiteId);
  const pages = snapshot ? (await listPages(websiteId, 1, MAX_LIMIT)).items : [];
  const chunks = snapshot ? (await listChunks(websiteId, 1, MAX_LIMIT)).items : [];
  const checks = await qualityChecks(websiteId);
  const payload = { generatedAt: new Date().toISOString(), websiteId, snapshot, pages, chunks, qualityChecks: checks, latestSearch };
  if (format === 'json') return { contentType: 'application/json', body: JSON.stringify(payload, null, 2) };
  if (format === 'markdown') {
    const body = [`# Knowledge Debug Export`, ``, `Website: ${websiteId}`, `Generated: ${payload.generatedAt}`, ``, `## Snapshot`, '```json', JSON.stringify(payload.snapshot, null, 2), '```', ``, `## Latest Search`, '```json', JSON.stringify(latestSearch ?? null, null, 2), '```'].join('\n');
    return { contentType: 'text/markdown', body };
  }
  return { contentType: 'text/plain', body: JSON.stringify(payload, null, 2) };
}
