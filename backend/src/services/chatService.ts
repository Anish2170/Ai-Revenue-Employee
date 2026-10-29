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
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import { abortable } from '../llm/cancellation.js';
import { buildChatSafetyPlan, composeSafeChatReply, safeChatSourceUrl, validateChatDraft, type ChatSafetyPlan } from '../language/chatSafety.js';
import { chatFailureMessage, chatRetrievalQuery, resolveChatLanguage, type ChatLanguageState } from '../language/chatLanguage.js';
import {answerQuery} from '../context/retrievalPlan.js';
import {composeEvidenceCoverage} from '../context/evidenceCoverage.js';

export interface ChatStreamInput {
  messages: ChatMessage[];
  behaviour?: VisitorBehaviour;
  tenant?: { websiteId: string; instructions: BusinessInstructions; businessActions?: BusinessActionConfig[] };
  /** Server-only capability/read seams, never populated from public request JSON. */
  leadCaptureAvailable?: boolean;
  allowLeadInvitation?: boolean;
  refreshActions?: () => Promise<BusinessActionConfig[]>;
  signal?: AbortSignal;
  onSafetyDecision?: (decision: { state: string; draft: string; reasons: string[]; modelUsed: boolean }) => void;
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

function retrievedChunkIds(context: ResolvedContext): string[] {
  return context.chunks.map((chunk) => chunk.id);
}

function retrievedChunkMetadata(context: ResolvedContext): Array<{ id: string; score: number }> {
  return context.chunks.map((chunk) => ({
    id: chunk.id,
    score: chunk.score,
  }));
}

function isSourceAttributionRequest(query: string): boolean {
  const normalized = query.toLowerCase();
  return /\b(source|sources)\b/.test(normalized)
    || /(?:किस पेज|कौन से पेज|कहाँ से|कहां से|स्रोत)/u.test(normalized)
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
    .replace(/[|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSourceAttributionReply(context: ResolvedContext, query: string, language: ChatLanguageState = { language: 'English', explicit: false }): {
  answer: string;
  source: ChatSource;
  chunkId: string;
  first100: string;
} | null {
  if (!isSourceAttributionRequest(query)) return null;
  // Other languages use the normal grounded model path instead of an English shortcut.
  if (!['English', 'Hindi', 'Hinglish'].includes(language.language)) return null;

  const chunk = context.chunks.find((item) => item.title.trim() && safeChatSourceUrl(item.url, context.instructions.websiteUrl));
  if (!chunk) return null;

  const title = cleanPageTitle(chunk.title) || chunk.heading || 'source';
  const subject = /gift\s*code/i.test(query) ? "today's gift code" : 'that information';

  return {
    answer: language.language === 'Hindi' ? `यह जानकारी जाँचने के लिए मिला संदर्भ: ${title}।`
      : language.language === 'Hinglish' ? `Yeh jaankari check karne ke liye mila reference: ${title}.`
      : `Retrieved reference for ${subject}: ${title}.`,
    source: { title, url: chunk.url },
    chunkId: chunk.id,
    first100: chunk.content.replace(/\s+/g, ' ').slice(0, 100),
  };
}

/** Buffer one bounded draft. No provider token, URL or partial failure escapes
 * before grounding. This trades token-by-token first paint for factual safety. */
async function* guardedReply(input: ChatStreamInput, context: ResolvedContext, plan: ChatSafetyPlan, source?: (signal: AbortSignal) => AsyncIterable<string>): AsyncIterable<ChatStreamEvent> {
  let draft = '', reasons: string[] = [], modelUsed = Boolean(source);
  if (source) {
    const controller = new AbortController();
    const cancel = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener('abort', cancel, { once: true });
    if (input.signal?.aborted) cancel();
    const timer = setTimeout(() => controller.abort(new Error('Chat response deadline exceeded')), 45000);
    const iterator = source(controller.signal)[Symbol.asyncIterator]();
    try {
      while (true) {
        const item = await abortable(iterator.next(), controller.signal);
        if (item.done) break;
        draft += item.value;
        if (draft.length > 8000) throw new Error('Chat response exceeded safety limit');
      }
    } catch (error) {
      if (input.signal?.aborted) throw error;
      controller.abort(error);
      reasons = ['provider_failure_or_limit'];
      chatTrace(input, 'draft_not_released', { reason: reasons[0] });
    } finally {
      clearTimeout(timer); input.signal?.removeEventListener('abort', cancel);
      // Do not wait for a provider that ignores cancellation. Observe close errors.
      if (reasons.length || controller.signal.aborted) void iterator.return?.().catch(() => undefined);
    }
  }
  // Configuration edits while generation was running cannot authorize a stale URL.
  if (input.refreshActions) {
    const leadOffer = plan.leadOffer;
    try { context.businessActions = await input.refreshActions(); }
    catch { context.businessActions = []; }
    plan = buildChatSafetyPlan(context, plan.query, plan.language, plan.leadCapture);
    plan.leadOffer &&= leadOffer;
  }
  if (input.signal?.aborted) throw input.signal.reason ?? new Error('Chat cancelled');
  if (source && !reasons.length) reasons = validateChatDraft(draft, plan).reasons;
  input.onSafetyDecision?.({ state: plan.state, draft, reasons, modelUsed });
  // Follow-up invitations are server-composed only, and never promise delivery.
  const directRendering = ['English', 'Hindi', 'Hinglish'].includes(plan.language.language);
  const answer = source && !reasons.length && !plan.leadOffer && !['booking', 'booking_link'].includes(plan.kind) && directRendering ? draft : composeSafeChatReply(plan);
  yield { type: 'token', text: answer || chatFailureMessage(plan.language) };
  const cited = plan.state.startsWith('known') ? [...plan.selected.map(fact => fact.chunk), ...plan.excerpts] : [];
  const seen = new Set<string>();
  for (const chunk of cited) {
    const url = safeChatSourceUrl(chunk.url, context.instructions.websiteUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url); yield { type: 'source', source: { title: chunk.title || chunk.heading || 'Source', url } };
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
  const retrievalQuery = sourceRequest && previousUser ? previousUser : chatRetrievalQuery(messages) || query;
  chatTrace(input, 'retrieval:start', {
    sourceRequest,
    previousUserUsed: sourceRequest && Boolean(previousUser),
    tenantWebsiteId: input.tenant?.websiteId ?? null,
  });
  const context = await getBusinessContext({ query: retrievalQuery, behaviour: input.behaviour, tenant: input.tenant, signal: input.signal,history:userMessages.slice(0,-1),purpose:'chat' });
  context.websiteId = input.tenant?.websiteId;
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

  const language = resolveChatLanguage(messages, context.instructions.language, input.conversation?.language);
  const plan = buildChatSafetyPlan(context, answerQuery(retrievalQuery,context.retrieval), language, input.leadCaptureAvailable === true);
  const coverage=!sourceRequest?composeEvidenceCoverage(context,retrievalQuery,language):null;
  if(coverage){
    input.onSafetyDecision?.({state:coverage.complete?'known_positive':'partial',draft:'',reasons:coverage.parts.filter(part=>!part.state.startsWith('known')).map(part=>`${part.need}:${part.state}`),modelUsed:false});
    return (async function*():AsyncIterable<ChatStreamEvent>{
      if(input.signal?.aborted)throw input.signal.reason;
      yield {type:'token',text:coverage.text};
      const seen=new Set<string>();for(const chunk of coverage.sources){const url=safeChatSourceUrl(chunk.url,context.instructions.websiteUrl);if(url&&!seen.has(url)){seen.add(url);yield {type:'source',source:{title:chunk.title||chunk.heading||'Source',url}};}}
    })();
  }
  // An unrelated retrieved page is not a citation proving the previous answer.
  const sourceChunks = [...new Map([...plan.selected.map(fact => fact.chunk), ...plan.excerpts].map(chunk => [chunk.id, chunk])).values()];
  const sourceReply = plan.state.startsWith('known') ? buildSourceAttributionReply({ ...context, chunks: sourceChunks }, query, language) : null;
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

  plan.leadOffer &&= input.allowLeadInvitation === true;
  // Respect refusal, previous invitation and already supplied contact details.
  if (messages.some(message => /no thanks|not interested|do not contact|don't contact|nahi chahiye|नहीं चाहिए/iu.test(message.content))
    || messages.some(message => /[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(message.content))
    || messages.filter(message => message.role === 'assistant').some(message => /email address|ईमेल पता|email.*bata/iu.test(message.content))) plan.leadOffer = false;
  if (plan.contactSubmission || plan.kind === 'conversation' || !plan.state.startsWith('known') || plan.excerpts.length) return guardedReply(input, context, plan);
  const prompt = promptRegistry.chat.active.build(context, messages, summary, opener, input.conversation, plan);
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

  return guardedReply(input, context, plan, (signal) => streamChat({
    system: prompt.system,
    messages: prompt.messages,
    debug: { requestId: input.debug?.requestId, pipeline: 'chat' },
    signal,
  }));
}


