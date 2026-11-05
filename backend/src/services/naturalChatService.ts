import { config } from '../config/index.js';
import { getBusinessContext } from '../context/provider.js';
import { answerQuery } from '../context/retrievalPlan.js';
import { composeEvidenceCoverage } from '../context/evidenceCoverage.js';
import { understandChat, conversationalReply } from '../language/chatConversation.js';
import { resolveChatLanguage, chatRetrievalQuery, chatFailureMessage } from '../language/chatLanguage.js';
import { buildChatSafetyPlan, composeSafeChatReply, safeChatSourceUrl, validateChatDraft } from '../language/chatSafety.js';
import { llmAvailable, streamChat } from '../llm/index.js';
import { abortable, checkCancelled, deadlineScope } from '../llm/cancellation.js';
import type { TokenUsage } from '../llm/provider/types.js';
import { logger } from '../logging/logger.js';
import { naturalChatPrompt } from '../prompts/naturalChatPrompt.js';
import { trustedChatContext, hardChatDraftReasons, reviewChatDraft } from './chatGrounding.js';
import { chatCacheKey, readChatAnswer, saveChatAnswer } from './chatAnswerCache.js';
import type { ChatStreamInput, ChatStreamEvent } from './chatService.js';
import type { RetrievedChunk } from '../context/types.js';

function eventsFor(text: string, chunks: RetrievedChunk[], websiteUrl?: string): ChatStreamEvent[] {
  const events: ChatStreamEvent[] = [{ type: 'token', text }], seen = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.sourceKind === 'TEXT' || chunk.sourceKind === 'FILE') continue;
    const url = safeChatSourceUrl(chunk.url, websiteUrl);
    if (url && !seen.has(url)) { seen.add(url); events.push({ type: 'source', source: { title: chunk.title || chunk.heading || 'Source', url } }); }
  }
  return events;
}
export async function* naturalChatReply(input: ChatStreamInput): AsyncIterable<ChatStreamEvent> {
  checkCancelled(input.signal);
  const firstUser = input.messages.findIndex(m => m.role === 'user');
  const messages = firstUser < 0 ? [] : input.messages.slice(firstUser);
  const intent = understandChat(messages), language = resolveChatLanguage(messages, input.tenant?.instructions.language, input.conversation?.language);
  const meta = { requestId: input.debug?.requestId ?? null, websiteId: input.tenant?.websiteId ?? null };
  // Greetings and thanks need neither query embeddings nor generation.
  if (intent.kind === 'social') {
    logger.info('[chat] natural route', { ...meta, route: 'local_social', providerRequests: 0 });
    yield { type: 'token', text: conversationalReply(intent, language) }; return;
  }
  if (input.refreshActions && input.tenant) {
    let actions = [] as NonNullable<ChatStreamInput['tenant']>['businessActions'];
    try { actions = await abortable(input.refreshActions(), input.signal); } catch { checkCancelled(input.signal); }
    input = { ...input, tenant: { ...input.tenant, businessActions: actions } };
  }
  let key: string | null = null;
  if (!input.onContextResolved) try { key = await chatCacheKey(input, intent, language); } catch { /* Cache failure cannot block chat. */ }
  const cached = readChatAnswer(key);
  if (cached) {
    checkCancelled(input.signal);
    logger.info('[chat] natural route', { ...meta, route: 'answer_cache', providerRequests: 0 });
    yield* cached; return;
  }
  const users = messages.filter(m => m.role === 'user').map(m => m.content), last = users.at(-1) ?? '';
  const sourceRequest = /\bsource|which page|kis page|स्रोत/iu.test(last);
  const query = sourceRequest && users.length > 1 ? users.at(-2)! : intent.factQuery !== last ? intent.factQuery : chatRetrievalQuery(messages) || last;
  const context = trustedChatContext(await getBusinessContext({ query, tenant: input.tenant, behaviour: input.behaviour,
    history: users.slice(0, -1), purpose: 'chat', signal: input.signal }));
  context.websiteId = input.tenant?.websiteId;
  input.onContextResolved?.(context);
  let plan = buildChatSafetyPlan(context, answerQuery(query, context.retrieval), language, input.leadCaptureAvailable === true, intent);
  plan.leadOffer &&= input.allowLeadInvitation === true;
  if (messages.some(m => /no thanks|not interested|do not contact|don't contact|nahi chahiye|नहीं चाहिए|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu.test(m.content))
    || messages.some(m => m.role === 'assistant' && /email address|ईमेल पता|email.*bata/iu.test(m.content))) plan.leadOffer = false;
  const coverage = intent.kind === 'factual' ? composeEvidenceCoverage(context, query, language) : null;
  let fallback = coverage?.text ?? composeSafeChatReply(plan);
  let fallbackChunks = coverage?.sources ?? (plan.state.startsWith('known') && intent.needsFacts ? [...plan.selected.map(f => f.chunk), ...plan.excerpts] : []);
  // Transaction acknowledgements are server-owned. They must not promise a save
  // or booking that has not actually happened, even on provider failure.
  if (plan.contactSubmission || !llmAvailable()) {
    logger.info('[chat] natural route', { ...meta, route: plan.contactSubmission ? 'server_acknowledgement' : 'provider_unavailable' });
    yield* eventsFor(fallback, fallbackChunks, context.instructions.websiteUrl); return;
  }
  const prompt = naturalChatPrompt(context, { ...plan, query: last }, input, messages);
  const usage = (stage: string) => (value: TokenUsage) => logger.info('[chat] token usage', { ...meta, stage, ...value });
  const scope = deadlineScope(input.signal, config.chat.deadlineMs), deadlineAt = Date.now() + config.chat.deadlineMs;
  let draft = '', reasons: string[] = [], chunks: RetrievedChunk[] = [], cacheable = false, route = 'validated_provider', answerState: string = plan.state;
  const iterator = streamChat({ ...prompt, signal: scope.signal, maxOutputTokens: config.chat.maxOutputTokens,
    onUsage: usage('answer'), debug: { requestId: input.debug?.requestId, pipeline: 'natural-chat' } })[Symbol.asyncIterator]();
  try {
    while (true) {
      const item = await abortable(iterator.next(), scope.signal);
      if (item.done) break;
      draft += item.value;
      if (draft.length > 8000) throw Error('oversized_draft');
    }
    if (input.refreshActions) {
      try { context.businessActions = await abortable(input.refreshActions(), scope.signal); } catch { context.businessActions = []; }
      const leadOffer = plan.leadOffer;
      plan = buildChatSafetyPlan(context, plan.query, language, input.leadCaptureAvailable === true, intent); plan.leadOffer &&= leadOffer;
      const refreshedCoverage = intent.kind === 'factual' ? composeEvidenceCoverage(context, query, language) : null;
      fallback = refreshedCoverage?.text ?? composeSafeChatReply(plan);
      fallbackChunks = refreshedCoverage?.sources ?? (plan.state.startsWith('known') && intent.needsFacts ? [...plan.selected.map(f => f.chunk), ...plan.excerpts] : []);
    }
    reasons = hardChatDraftReasons(draft, context, plan);
    if (!reasons.length) {
      const cheap = validateChatDraft(draft, plan);
      if (cheap.ok && plan.state.startsWith('known') && !coverage && (context.retrieval?.coverage.length ?? 0) <= 1
        && plan.selected.length <= 1 && plan.excerpts.length <= 1) {
        chunks = intent.needsFacts ? [...plan.selected.map(f => f.chunk), ...plan.excerpts] : [];
        cacheable = chunks.length > 0 && intent.kind === 'factual';
      } else {
        // A bounded second call checks novel paraphrases/unknown/partial replies.
        // Exact supported answers and cache hits do not pay this verification cost.
        const review = await reviewChatDraft(draft, context, { ...plan, query: last }, {
          signal: scope.signal, deadlineAt, onUsage: usage('grounding'), debug: { requestId: input.debug?.requestId, pipeline: 'chat-grounding' } }, prompt.messages);
        if (!review.ok) reasons = [review.reason];
        else { chunks = review.chunks; cacheable = review.cacheable; route = 'semantic_validated_provider'; answerState = review.answerability === 'supported' ? 'known_positive' : review.answerability ?? plan.state; }
      }
    }
  } catch {
    checkCancelled(input.signal);
    reasons = ['provider_or_grounding_failure'];
  } finally {
    scope.close();
    if (reasons.length || scope.signal.aborted) void iterator.return?.().catch(() => undefined);
  }
  checkCancelled(input.signal);
  const accepted = reasons.length === 0;
  input.onSafetyDecision?.({ state: accepted ? answerState : plan.state, draft, reasons, modelUsed: true });
  logger.info('[chat] natural route', { ...meta, route: accepted ? route : 'safe_fallback', reasonCodes: reasons,
    evidenceStatus: accepted ? answerState : plan.state, sourceCount: accepted ? chunks.length : fallbackChunks.length, cacheEligible: Boolean(key && cacheable && accepted) });
  const result = eventsFor(accepted ? draft : fallback || chatFailureMessage(language), accepted ? chunks : fallbackChunks, context.instructions.websiteUrl);
  if (accepted && cacheable && !plan.leadOffer) {
    // Recompute after action refresh and generation; edits during the request
    // cannot write a stale draft under the next version's identity.
    let currentKey: string | null = null;
    try { currentKey = await chatCacheKey({ ...input, tenant: input.tenant ? { ...input.tenant, businessActions: context.businessActions } : undefined }, intent, language); } catch { /* no cache */ }
    if (key && currentKey === key) saveChatAnswer(key, result);
  }
  yield* result;
}
