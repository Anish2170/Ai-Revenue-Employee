/**
 * Chat service - builds the chat prompt and returns a streaming token source.
 *
 * Sprint 2: retrieves RAG context using the latest user message as the query.
 * Returns an async iterable so the route can relay tokens as Server-Sent Events.
 */
import { getBusinessContext } from '../context/provider.js';
import { summarize } from '../behaviour/summarizer.js';
import { promptRegistry } from '../prompts/registry.js';
import { streamChat } from '../llm/index.js';
import { config } from '../config/index.js';
import type { ChatMessage, VisitorBehaviour } from '../types.js';
import type { BusinessInstructions, ResolvedContext } from '../context/types.js';
import type { PromptConversationContext } from '../conversations/conversation.service.js';
import { logger } from '../logging/logger.js';

export interface ChatStreamInput {
  messages: ChatMessage[];
  behaviour?: VisitorBehaviour;
  tenant?: { websiteId: string; instructions: BusinessInstructions };
  conversation?: PromptConversationContext;
  debug?: { requestId?: string };
}

export interface ChatSource {
  title: string;
  url: string;
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'source'; source: ChatSource };

function chatTrace(input: ChatStreamInput, stage: string, detail?: unknown): void {
  if (!config.debugTrace) return;
  const id = input.debug?.requestId ?? 'no-request-id';
  logger.debug(`[chat:${id}] ${stage}`, detail);
}

function serializeError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { value: String(err) };
  return { name: err.name, message: err.message };
}

function retrievedChunkIds(context: ResolvedContext): string[] {
  return context.chunks.map((chunk) => chunk.id);
}

function retrievedChunkMetadata(context: ResolvedContext): Array<{ id: string; score: number }> {
  return context.chunks.map((chunk) => ({
    id: chunk.id,
    score: chunk.score,
  }));
}

function geminiStatusFromError(err: unknown): '429' | 'error' {
  const text = err instanceof Error ? `${err.name} ${err.message} ${err.stack ?? ''}` : String(err);
  return /\b429\b|Too Many Requests/i.test(text) ? '429' : 'error';
}

function isSourceAttributionRequest(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(source|sources|link|url)\b/.test(normalized)
    || /\b(which|what)\s+page\b/.test(normalized)
    || /\bwhere\s+(did|does|is|was|you)\b.*\b(get|got|found|find|from|taken)\b/.test(normalized)
    || /\b(get|got|found|find|taken)\b.*\bfrom\b/.test(normalized)
    || /\b(kis|kaun|kon|which)\s+page\b/.test(normalized)
    || /\b(kahan|kahaan|kidhar)\s+se\b/.test(normalized)
    || /\b(page|source|link)\s+se\b/.test(normalized)
    || /\bse\s+(liya|mila|milaa|aaya|aya)\b/.test(normalized);
}

function cleanPageTitle(title: string): string {
  return title
    .replace(/thecolourtrading\.in/gi, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildSourceAttributionReply(context: ResolvedContext, query: string): {
  answer: string;
  source: ChatSource;
  chunkId: string;
  first100: string;
} | null {
  if (!isSourceAttributionRequest(query)) return null;

  const chunk = context.chunks.find((item) => item.title.trim() && item.url.trim());
  if (!chunk) return null;

  const title = cleanPageTitle(chunk.title) || chunk.heading || 'source';
  const subject = /gift\s*code/i.test(query) ? "today's gift code" : 'that information';

  return {
    answer: `I found ${subject} on our ${title} page.`,
    source: { title, url: chunk.url },
    chunkId: chunk.id,
    first100: chunk.content.replace(/\s+/g, ' ').slice(0, 100),
  };
}

async function* singleToken(text: string): AsyncIterable<ChatStreamEvent> {
  yield { type: 'token', text };
}

async function* withGroundedProviderFallback(
  input: ChatStreamInput,
  source: AsyncIterable<string>,
  context: ResolvedContext,
  query: string,
): AsyncIterable<ChatStreamEvent> {
  let emitted = false;
  try {
    for await (const token of source) {
      if (token.length > 0) emitted = true;
      yield { type: 'token', text: token };
    }

    chatTrace(input, 'llm_debug', {
      llm_used: emitted,
      fallback_used: false,
      gemini_status: 'success',
      retrieved_chunk_ids: retrievedChunkIds(context),
    });
  } catch (err) {
    const geminiStatus = geminiStatusFromError(err);
    chatTrace(input, 'LLM provider failed during stream', serializeError(err));

    if (emitted) {
      chatTrace(input, 'llm_debug', {
        llm_used: true,
        fallback_used: false,
        gemini_status: geminiStatus,
        retrieved_chunk_ids: retrievedChunkIds(context),
        note: 'Gemini failed after producing at least one token; fallback intentionally skipped.',
      });
      throw err;
    }

    chatTrace(input, 'llm_debug', {
      llm_used: false,
      fallback_used: false,
      gemini_status: geminiStatus,
      retrieved_chunk_ids: retrievedChunkIds(context),
    });
    throw err;
  }
}

/**
 * Produce a streaming chat completion for the given conversation.
 * @returns an async iterable of chat stream events.
 */
export async function streamChatReply(input: ChatStreamInput): Promise<AsyncIterable<ChatStreamEvent>> {
  chatTrace(input, 'strategy', {
    name: 'direct_chat_rag',
    note: 'chat answers from retrieved business knowledge; no interrupt decision here',
  });
  const summary = input.behaviour ? summarize(input.behaviour) : undefined;

  // The widget may seed the conversation with an opening assistant message (the
  // popup text). Gemini requires history to START with a user turn, so we lift a
  // leading assistant message out and pass it to the prompt as context instead.
  let messages = input.messages;
  let opener: string | undefined;
  while (messages.length > 0 && messages[0].role === 'assistant') {
    if (!opener) opener = messages[0].content;
    messages = messages.slice(1);
  }

  // Retrieve knowledge relevant to the latest user message (fall back to the opener).
  const userMessages = messages.filter((m) => m.role === 'user').map((m) => m.content);
  const lastUser = userMessages[userMessages.length - 1];
  const previousUser = userMessages.length > 1 ? userMessages[userMessages.length - 2] : undefined;
  const query = lastUser || opener || '';
  const sourceRequest = lastUser ? isSourceAttributionRequest(lastUser) : false;
  const retrievalQuery = sourceRequest && previousUser ? previousUser : query;
  chatTrace(input, 'retrieval:start', {
    sourceRequest,
    previousUserUsed: sourceRequest && Boolean(previousUser),
    tenantWebsiteId: input.tenant?.websiteId ?? null,
  });
  const context = await getBusinessContext({ query: retrievalQuery, behaviour: input.behaviour, tenant: input.tenant });
  chatTrace(input, 'retrieval:result', {
    source: context.source,
    chunks: context.chunks.length,
    scores: context.scores,
    noKnowledge: context.chunks.length === 0,
  });
  chatTrace(input, 'retrieved_chunk_ids', retrievedChunkIds(context));
  chatTrace(input, 'retrieved_chunk_metadata', retrievedChunkMetadata(context));
  if (context.chunks.length === 0) console.warn(`[chat:${input.debug?.requestId ?? 'no-request-id'}] RAG returned no knowledge.`);
  if (context.source === 'fallback') console.warn(`[chat:${input.debug?.requestId ?? 'no-request-id'}] using static fallback context (dev request without tenant only).`);

  const sourceReply = buildSourceAttributionReply(context, query);
  if (sourceReply) {
    chatTrace(input, 'source_attribution_reply', {
      llm_used: false,
      fallback_used: false,
      source_chunk_id: sourceReply.chunkId,
      retrieved_chunk_ids: retrievedChunkIds(context),
    });
    return (async function* sourceAttributionStream(): AsyncIterable<ChatStreamEvent> {
      yield { type: 'token', text: sourceReply.answer };
      yield { type: 'source', source: sourceReply.source };
    })();
  }

  const prompt = promptRegistry.chat.active.build(context, messages, summary, opener, input.conversation);
  const leadInstructionIndex = prompt.system.indexOf('Intelligent lead capture:');
  const leadInstructionsPresent = leadInstructionIndex >= 0;
  chatTrace(input, 'prompt_builder', {
    version: promptRegistry.chat.active.version,
    messages: prompt.messages.length,
    conversationSummaryChars: input.conversation?.summary?.length ?? 0,
    conversationMemories: input.conversation?.memories.length ?? 0,
    systemChars: prompt.system.length,
    leadInstructionsPresent,
    leadInstructionIndex,
    charsAfterLeadInstructions: leadInstructionsPresent ? prompt.system.length - leadInstructionIndex : 0,
    promptTruncatedBeforeSend: false,
    truncationNote: 'No application-level truncation is applied after prompt construction in this route.',
  });
  chatTrace(input, 'final prompt sent to LLM', {
    provider: `${config.llm.primary.provider}:${config.llm.primary.model}`,
    messageCount: prompt.messages.length,
    totalChars: prompt.system.length + prompt.messages.reduce((sum, message) => sum + message.content.length, 0),
  });
  chatTrace(input, 'LLM request handoff', { provider: `${config.llm.primary.provider}:${config.llm.primary.model}` });

  const stream = streamChat({
    system: prompt.system,
    messages: prompt.messages,
    debug: { requestId: input.debug?.requestId, pipeline: 'chat' },
  });

  return withGroundedProviderFallback(input, stream, context, query);
}


