import { prisma } from '../db/prisma.js';
import { generateDecision, llmAvailable } from '../llm/index.js';
import type { ChatMessage } from '../validation/requestSchemas.js';
import type { VisitorBehaviour } from '../types.js';

type ConversationTenant = {
  organizationId: string;
  websiteId: string;
};

type SourceMeta = { title: string; url: string } | null | undefined;

export type ConversationSummary = {
  id: string;
  websiteId: string;
  visitorId: string | null;
  title: string;
  titleSource: string;
  titleStatus: string;
  status: string;
  summary: string | null;
  totalMessages: number;
  currentPage: string | null;
  device: string | null;
  startedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  deletedAt: Date | null;
};

export type WidgetConversation = ConversationSummary & {
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    source: { title: string; url: string } | null;
    timestamp: Date;
  }>;
  memories: Array<{ id: string; kind: string; content: string; confidence: number | null }>;
};

export type PromptConversationContext = {
  conversationId: string;
  summary?: string;
  memories: string[];
  recentMessages: ChatMessage[];
};

const DEFAULT_TITLE = 'New Chat';
const RECENT_MESSAGE_LIMIT = 12;
const SUMMARY_BATCH_SIZE = 8;
const MAX_MEMORY_ROWS = 12;

const TITLE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short 3 to 6 word conversation title.' },
  },
  required: ['title'],
};

const MEMORY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Concise running summary of the conversation so far.' },
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'Short category such as interest, plan, objection, request, preference.' },
          content: { type: 'string', description: 'Durable visitor fact worth remembering.' },
          confidence: { type: 'number' },
        },
        required: ['kind', 'content'],
      },
    },
  },
  required: ['summary', 'memories'],
};

const conversationSummarySelect = {
  id: true,
  websiteId: true,
  visitorId: true,
  title: true,
  titleSource: true,
  titleStatus: true,
  status: true,
  summary: true,
  totalMessages: true,
  currentPage: true,
  device: true,
  startedAt: true,
  createdAt: true,
  updatedAt: true,
  lastMessageAt: true,
  deletedAt: true,
} as const;

function pageFromBehaviour(behaviour?: VisitorBehaviour): string | undefined {
  return behaviour?.page || undefined;
}

function deviceFromBehaviour(behaviour?: VisitorBehaviour): string | undefined {
  const width = behaviour?.viewport?.width ?? 0;
  if (width > 0 && width < 768) return 'mobile';
  if (width >= 768 && width < 1100) return 'tablet';
  if (width >= 1100) return 'desktop';
  return undefined;
}

function firstUserMessage(messages: ChatMessage[]): string | undefined {
  return messages.find((message) => message.role === 'user')?.content.trim();
}

function latestUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  return [...messages].reverse().find((message) => message.role === 'user');
}

function isMeaningfulMessage(message: string | undefined): message is string {
  if (!message) return false;
  const words = message.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [];
  return message.length >= 8 && words.length >= 2;
}

function compactMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}

function sanitizeTitle(raw: string): string {
  const cleaned = raw.replace(/["'`]/g, '').replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ').filter(Boolean).slice(0, 6);
  if (words.length < 2) return DEFAULT_TITLE;
  return words.join(' ').slice(0, 80);
}

function heuristicTitle(message: string): string {
  const stop = new Set(['a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'is', 'it', 'me', 'need', 'of', 'our', 'please', 'the', 'to', 'want', 'what', 'with', 'your']);
  const words = (message.match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) ?? [])
    .filter((word) => !stop.has(word.toLowerCase()))
    .slice(0, 4)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
  return words.length >= 2 ? words.join(' ') : DEFAULT_TITLE;
}

function sourceMetadata(source: SourceMeta): Record<string, unknown> {
  return source ? { title: source.title, url: source.url } : {};
}

function toChatMessage(message: { role: string; content: string; sourceTitle?: string | null; sourceUrl?: string | null }): ChatMessage {
  return {
    role: message.role === 'USER' ? 'user' : 'assistant',
    content: message.content,
    ...(message.sourceTitle && message.sourceUrl ? { source: { title: message.sourceTitle, url: message.sourceUrl } } : {}),
  };
}

function toWidgetConversation(conversation: any): WidgetConversation {
  return {
    ...conversation,
    messages: (conversation.messages ?? []).map((message: any) => ({
      id: message.id,
      role: message.role === 'USER' ? 'user' : 'assistant',
      content: message.content,
      source: message.sourceTitle && message.sourceUrl ? { title: message.sourceTitle, url: message.sourceUrl } : null,
      timestamp: message.timestamp ?? message.createdAt,
    })),
    memories: (conversation.memories ?? []).map((memory: any) => ({
      id: memory.id,
      kind: memory.kind,
      content: memory.content,
      confidence: memory.confidence ?? null,
    })),
  };
}

async function assertConversationOwner(organizationId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId, deletedAt: null },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
      memories: { orderBy: { updatedAt: 'desc' }, take: MAX_MEMORY_ROWS },
    },
  });
  if (!conversation) throw new ConversationNotFoundError();
  return conversation;
}

async function findWidgetConversation(tenant: ConversationTenant, visitorId: string, conversationId: string) {
  return prisma.conversation.findFirst({
    where: { id: conversationId, organizationId: tenant.organizationId, websiteId: tenant.websiteId, visitorId, deletedAt: null },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
      memories: { orderBy: { updatedAt: 'desc' }, take: MAX_MEMORY_ROWS },
    },
  });
}

export class ConversationNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super('Conversation not found.');
  }
}

export async function ensureVisitor(input: { tenant: ConversationTenant; visitorId: string; behaviour?: VisitorBehaviour }) {
  const now = new Date();
  return prisma.visitor.upsert({
    where: { websiteId_visitorId: { websiteId: input.tenant.websiteId, visitorId: input.visitorId } },
    create: {
      organizationId: input.tenant.organizationId,
      websiteId: input.tenant.websiteId,
      visitorId: input.visitorId,
      currentPage: pageFromBehaviour(input.behaviour),
      device: deviceFromBehaviour(input.behaviour),
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      lastSeenAt: now,
      currentPage: pageFromBehaviour(input.behaviour),
      device: deviceFromBehaviour(input.behaviour),
    },
  });
}

export async function createConversation(input: {
  tenant: ConversationTenant;
  visitorId: string;
  sessionId?: string;
  behaviour?: VisitorBehaviour;
  opener?: string;
}): Promise<WidgetConversation> {
  const visitor = await ensureVisitor(input);
  const opener = input.opener?.trim();
  const conversation = await prisma.conversation.create({
    data: {
      organizationId: input.tenant.organizationId,
      websiteId: input.tenant.websiteId,
      visitorId: input.visitorId,
      visitorRecordId: visitor.id,
      sessionId: input.sessionId,
      currentPage: pageFromBehaviour(input.behaviour),
      device: deviceFromBehaviour(input.behaviour),
      totalMessages: opener ? 1 : 0,
      titleStatus: 'SKIPPED',
      messages: opener
        ? { create: [{ role: 'ASSISTANT', content: opener, timestamp: new Date() }] }
        : undefined,
    },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
      memories: { orderBy: { updatedAt: 'desc' }, take: MAX_MEMORY_ROWS },
    },
  });
  await prisma.visitor.update({ where: { id: visitor.id }, data: { lastConversationId: conversation.id } });
  return toWidgetConversation(conversation);
}

export async function restoreConversation(input: {
  tenant: ConversationTenant;
  visitorId: string;
  sessionId?: string;
  behaviour?: VisitorBehaviour;
  conversationId?: string;
}): Promise<WidgetConversation> {
  const visitor = await ensureVisitor(input);
  const id = input.conversationId ?? visitor.lastConversationId;
  if (id) {
    const existing = await findWidgetConversation(input.tenant, input.visitorId, id);
    if (existing) return toWidgetConversation(existing);
  }

  const latest = await prisma.conversation.findFirst({
    where: {
      organizationId: input.tenant.organizationId,
      websiteId: input.tenant.websiteId,
      visitorId: input.visitorId,
      status: 'OPEN',
      deletedAt: null,
    },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      messages: { orderBy: { timestamp: 'asc' } },
      memories: { orderBy: { updatedAt: 'desc' }, take: MAX_MEMORY_ROWS },
    },
  });
  if (latest) {
    await prisma.visitor.update({ where: { id: visitor.id }, data: { lastConversationId: latest.id } });
    return toWidgetConversation(latest);
  }
  return createConversation(input);
}

export async function switchConversation(input: {
  tenant: ConversationTenant;
  visitorId: string;
  conversationId: string;
  behaviour?: VisitorBehaviour;
}): Promise<WidgetConversation> {
  const visitor = await ensureVisitor(input);
  const conversation = await findWidgetConversation(input.tenant, input.visitorId, input.conversationId);
  if (!conversation) throw new ConversationNotFoundError();
  await prisma.visitor.update({ where: { id: visitor.id }, data: { lastConversationId: conversation.id } });
  return toWidgetConversation(conversation);
}

export async function listVisitorConversations(input: { tenant: ConversationTenant; visitorId: string }): Promise<ConversationSummary[]> {
  return prisma.conversation.findMany({
    where: { organizationId: input.tenant.organizationId, websiteId: input.tenant.websiteId, visitorId: input.visitorId, deletedAt: null },
    orderBy: { lastMessageAt: 'desc' },
    take: 50,
    select: conversationSummarySelect,
  });
}

export async function prepareConversationForChat(input: {
  tenant: ConversationTenant;
  conversationId?: string;
  visitorId: string;
  sessionId?: string;
  messages: ChatMessage[];
  behaviour?: VisitorBehaviour;
}): Promise<{ conversation: ConversationSummary; prompt: PromptConversationContext }> {
  const visitor = await ensureVisitor(input);
  const firstUser = firstUserMessage(input.messages);
  const latestUser = latestUserMessage(input.messages);
  const now = new Date();

  let conversation = input.conversationId
    ? await prisma.conversation.findFirst({
        where: {
          id: input.conversationId,
          organizationId: input.tenant.organizationId,
          websiteId: input.tenant.websiteId,
          visitorId: input.visitorId,
          deletedAt: null,
        },
      })
    : null;

  if (!conversation) {
    const created = await createConversation({ tenant: input.tenant, visitorId: input.visitorId, sessionId: input.sessionId, behaviour: input.behaviour });
    conversation = await prisma.conversation.findUnique({ where: { id: created.id } });
  }

  const activeConversation = conversation;
  if (!activeConversation) throw new ConversationNotFoundError();

  const pendingAssistantMessages = input.messages.filter((message) => message.role === 'assistant');
  for (const assistant of pendingAssistantMessages) {
    await prisma.conversationMessage.create({
      data: { conversationId: activeConversation.id, role: 'ASSISTANT', content: assistant.content, timestamp: now },
    });
  }

  if (latestUser) {
    await prisma.conversationMessage.create({
      data: { conversationId: activeConversation.id, role: 'USER', content: latestUser.content, timestamp: now },
    });
  }

  const updated = await prisma.conversation.update({
    where: { id: activeConversation.id },
    data: {
      lastMessageAt: now,
      visitorId: input.visitorId,
      visitorRecordId: visitor.id,
      sessionId: input.sessionId ?? activeConversation.sessionId,
      firstUserMessage: activeConversation.firstUserMessage ?? (firstUser ? compactMessage(firstUser) : null),
      titleStatus: activeConversation.titleStatus === 'SKIPPED' && isMeaningfulMessage(firstUser) ? 'PENDING' : activeConversation.titleStatus,
      totalMessages: { increment: (latestUser ? 1 : 0) + pendingAssistantMessages.length },
      currentPage: pageFromBehaviour(input.behaviour) ?? activeConversation.currentPage,
      device: deviceFromBehaviour(input.behaviour) ?? activeConversation.device,
    },
    select: conversationSummarySelect,
  });

  await prisma.visitor.update({ where: { id: visitor.id }, data: { lastConversationId: updated.id } });
  return { conversation: updated, prompt: await buildPromptContext(updated.id) };
}

export async function buildPromptContext(conversationId: string): Promise<PromptConversationContext> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      memories: { orderBy: { updatedAt: 'desc' }, take: MAX_MEMORY_ROWS },
      messages: { orderBy: { timestamp: 'desc' }, take: RECENT_MESSAGE_LIMIT },
    },
  });
  if (!conversation) throw new ConversationNotFoundError();
  const recentMessages = [...conversation.messages].reverse().map(toChatMessage);
  return {
    conversationId,
    summary: conversation.summary ?? undefined,
    memories: conversation.memories.map((memory) => memory.content),
    recentMessages,
  };
}

export async function appendAssistantMessage(input: { conversationId: string; content: string; source?: SourceMeta }): Promise<void> {
  if (!input.content.trim()) return;
  await prisma.$transaction([
    prisma.conversationMessage.create({
      data: {
        conversationId: input.conversationId,
        role: 'ASSISTANT',
        content: input.content,
        sourceTitle: input.source?.title,
        sourceUrl: input.source?.url,
        sourceMetadata: sourceMetadata(input.source) as any,
        timestamp: new Date(),
      },
    }),
    prisma.conversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: new Date(), totalMessages: { increment: 1 } },
    }),
  ]);
}

export function scheduleConversationMaintenance(conversationId: string): void {
  setTimeout(() => {
    Promise.all([generateTitleIfNeeded(conversationId), updateConversationMemoryIfNeeded(conversationId)]).catch((err) => {
      console.error('[conversation-maintenance] failed', err instanceof Error ? { name: err.name, message: err.message } : err);
    });
  }, 0);
}

export function scheduleTitleGeneration(conversationId: string): void {
  scheduleConversationMaintenance(conversationId);
}

export async function generateTitleIfNeeded(conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { timestamp: 'asc' }, take: 8 } },
  });
  if (!conversation) return;
  if (conversation.titleSource !== 'AUTO' || conversation.titleStatus === 'READY' || conversation.title !== DEFAULT_TITLE) return;

  const firstUser = conversation.firstUserMessage ?? firstUserMessage(conversation.messages.map(toChatMessage));
  if (!isMeaningfulMessage(firstUser)) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { titleStatus: 'SKIPPED' } });
    return;
  }

  let title = heuristicTitle(firstUser);
  if (llmAvailable()) {
    try {
      const transcript = conversation.messages.slice(0, 6).map((message) => `${message.role === 'USER' ? 'User' : 'Assistant'}: ${message.content.slice(0, 500)}`).join('\n');
      const result = await generateDecision({
        system: 'Create a short conversation title. Use 3 to 6 words. Describe the topic. Do not use punctuation, quotes, or generic labels like New Chat.',
        user: `Conversation:\n${transcript}`,
        schema: TITLE_SCHEMA,
      });
      const raw = typeof result === 'object' && result && 'title' in result ? String((result as { title: unknown }).title) : '';
      title = sanitizeTitle(raw);
    } catch (err) {
      console.warn('[conversation-title] using heuristic fallback', err instanceof Error ? err.message : String(err));
    }
  }

  if (title === DEFAULT_TITLE) {
    await prisma.conversation.update({ where: { id: conversation.id }, data: { titleStatus: 'SKIPPED' } });
    return;
  }

  await prisma.conversation.updateMany({
    where: { id: conversation.id, title: DEFAULT_TITLE, titleSource: 'AUTO', titleStatus: { not: 'READY' } },
    data: { title, titleStatus: 'READY', titleGeneratedAt: new Date() },
  });
}

export async function updateConversationMemoryIfNeeded(conversationId: string): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { messages: { orderBy: { timestamp: 'asc' } } },
  });
  if (!conversation) return;
  const unsummarized = conversation.messages.length - conversation.summarizedMessageCount;
  if (unsummarized < SUMMARY_BATCH_SIZE) return;

  const transcript = conversation.messages
    .slice(Math.max(0, conversation.summarizedMessageCount))
    .map((message) => `${message.role === 'USER' ? 'User' : 'Assistant'}: ${message.content.slice(0, 700)}`)
    .join('\n');

  let summary = conversation.summary ?? '';
  let memories: Array<{ kind: string; content: string; confidence?: number }> = [];

  if (llmAvailable()) {
    try {
      const result = await generateDecision({
        system: 'Update durable conversation memory. Keep the summary concise. Extract only long-term visitor facts, interests, needs, objections, or requests. Do not store every message.',
        user: `Existing summary:\n${summary || '(none)'}\n\nNew transcript:\n${transcript}`,
        schema: MEMORY_SCHEMA,
      });
      if (typeof result === 'object' && result) {
        const obj = result as { summary?: unknown; memories?: unknown };
        summary = typeof obj.summary === 'string' ? obj.summary.slice(0, 3000) : summary;
        memories = Array.isArray(obj.memories)
          ? obj.memories
              .map((item) => item as { kind?: unknown; content?: unknown; confidence?: unknown })
              .filter((item) => typeof item.content === 'string' && item.content.trim().length > 0)
              .slice(0, 6)
              .map((item) => ({
                kind: typeof item.kind === 'string' ? item.kind.slice(0, 40) : 'fact',
                content: String(item.content).replace(/\s+/g, ' ').trim().slice(0, 300),
                confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
              }))
          : [];
      }
    } catch (err) {
      console.warn('[conversation-memory] summarizer fallback', err instanceof Error ? err.message : String(err));
    }
  }

  if (!summary) {
    summary = transcript.replace(/\s+/g, ' ').slice(0, 1000);
  }

  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { summary, summaryUpdatedAt: new Date(), summarizedMessageCount: conversation.messages.length },
    }),
    ...memories.map((memory) => prisma.conversationMemory.create({
      data: {
        conversationId: conversation.id,
        organizationId: conversation.organizationId,
        websiteId: conversation.websiteId,
        visitorId: conversation.visitorId,
        kind: memory.kind,
        content: memory.content,
        confidence: memory.confidence,
      },
    })),
  ]);
}

export async function listConversations(organizationId: string, websiteId?: string): Promise<Array<ConversationSummary & { messageCount: number; memoryCount: number }>> {
  const conversations = await prisma.conversation.findMany({
    where: { organizationId, ...(websiteId ? { websiteId } : {}), deletedAt: null },
    orderBy: { lastMessageAt: 'desc' },
    take: 200,
    select: { ...conversationSummarySelect, _count: { select: { messages: true, memories: true } } },
  });
  return conversations.map((conversation) => ({
    ...conversation,
    messageCount: conversation._count.messages,
    memoryCount: conversation._count.memories,
  }));
}

export async function getConversation(organizationId: string, conversationId: string) {
  const conversation = await assertConversationOwner(organizationId, conversationId);
  return toWidgetConversation(conversation);
}

export async function renameConversation(organizationId: string, conversationId: string, title: string): Promise<ConversationSummary> {
  await assertConversationOwner(organizationId, conversationId);
  const sanitized = sanitizeTitle(title);
  return prisma.conversation.update({
    where: { id: conversationId },
    data: {
      title: sanitized === DEFAULT_TITLE ? title.trim().slice(0, 80) : sanitized,
      titleSource: 'MANUAL',
      titleStatus: 'READY',
      titleGeneratedAt: new Date(),
    },
    select: conversationSummarySelect,
  });
}