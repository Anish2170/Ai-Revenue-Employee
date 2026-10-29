/** Provider-neutral LLM facade: primary generation with Gemini failover; Gemini embeddings. */
import { config, hasLLM } from '../config/index.js';
import { logger } from '../logging/logger.js';
import { createGeminiProvider } from './provider/gemini.js';
import { createOpenAIProvider } from './provider/openai.js';
import { failureCategory, isRetryable } from './provider/errors.js';
import type { EmbedTaskType, LLMProvider, StreamRequest, StructuredRequest } from './provider/types.js';
import { abortable, checkCancelled, deadlineScope } from './cancellation.js';

let primary: LLMProvider | null = null;
let fallback: LLMProvider | null = null;

function primaryProvider(): LLMProvider {
  if (primary) return primary;
  if (!config.llm.primary.apiKey.trim()) throw new Error('Primary LLM provider is not configured.');
  if (config.llm.primary.provider !== 'openai') throw new Error(`Unsupported PRIMARY_LLM_PROVIDER: ${config.llm.primary.provider}`);
  return primary ??= createOpenAIProvider();
}
function fallbackProvider(): LLMProvider {
  if (fallback) return fallback;
  if (!config.gemini.apiKey.trim()) throw new Error('Gemini fallback is not configured.');
  if (config.llm.fallback.provider !== 'gemini') throw new Error(`Unsupported FALLBACK_LLM_PROVIDER: ${config.llm.fallback.provider}`);
  return fallback ??= createGeminiProvider(config.llm.fallback.model);
}
function delay(attempt: number): Promise<void> {
  const ms = Math.min(750, 150 * 2 ** attempt) + Math.floor(Math.random() * 100);
  return new Promise(resolve => setTimeout(resolve, ms));
}
function logFailover(req: StreamRequest | StructuredRequest, values: Record<string, unknown>): void {
  logger.warn('[llm] generation failover metadata', { requestId: 'debug' in req ? req.debug?.requestId ?? null : null, primaryProvider: config.llm.primary.provider, primaryModel: config.llm.primary.model, fallbackProvider: config.llm.fallback.provider, fallbackModel: config.llm.fallback.model, ...values });
}

export function llmAvailable(): boolean { return hasLLM; }

// A missing credential is configuration state, not a retryable provider outage.
// Keep the configured primary first whenever it is present. Test overrides keep
// exercising the same retry/cancellation paths without requiring real secrets.
function primaryUnconfigured(): boolean {
  return !primary && config.llm.primary.provider === 'openai' && !config.llm.primary.apiKey.trim();
}

export async function generateDecision(req: StructuredRequest): Promise<unknown> {
  if (req.deadlineAt === undefined) return generateDecisionInternal(req);
  const scope = deadlineScope(req.signal, req.deadlineAt - Date.now());
  try { return await abortable(generateDecisionInternal({ ...req, signal: scope.signal }), scope.signal); }
  finally { scope.close(); }
}

async function generateDecisionInternal(req: StructuredRequest): Promise<unknown> {
  checkCancelled(req.signal);
  if (primaryUnconfigured()) {
    logFailover(req, { fallbackUsed: true, failureCategory: 'primary_unconfigured', retryCount: 0 });
    return abortable(fallbackProvider().generateStructured(req), req.signal);
  }
  // Proactive requests have one shared deadline. Give the primary at most half
  // the remaining time, leaving useful time for one non-overlapping fallback.
  if (req.deadlineAt !== undefined) {
    checkCancelled(req.signal);
    const remaining = req.deadlineAt - Date.now();
    const primaryBudget = Math.min(4000, Math.max(0, remaining / 2));
    const primaryScope = deadlineScope(req.signal, primaryBudget);
    let failure: unknown;
    try { return await abortable(primaryProvider().generateStructured({ ...req, signal: primaryScope.signal, deadlineAt: Date.now() + primaryBudget }), primaryScope.signal); }
    catch (error) { failure = error; }
    finally { primaryScope.close(); }
    checkCancelled(req.signal);
    if (!isRetryable(failure) || Date.now() >= req.deadlineAt) throw failure;
    logFailover(req, { fallbackUsed: true, failureCategory: failureCategory(failure), retryCount: 0 });
    return abortable(fallbackProvider().generateStructured(req), req.signal);
  }
  let last: unknown;
  for (let attempt = 0; attempt <= config.llm.primaryRetries; attempt++) {
    checkCancelled(req.signal);
    try { return await abortable(primaryProvider().generateStructured(req), req.signal); }
    catch (error) { checkCancelled(req.signal); last = error; if (!isRetryable(error) || failureCategory(error) === 'rate_limit' || attempt === config.llm.primaryRetries) break; await abortable(delay(attempt), req.signal); }
  }
  if (!isRetryable(last)) throw last;
  logFailover(req, { fallbackUsed: true, failureCategory: failureCategory(last), retryCount: config.llm.primaryRetries });
  checkCancelled(req.signal);
  return abortable(fallbackProvider().generateStructured(req), req.signal);
}

export async function* streamChat(req: StreamRequest): AsyncIterable<string> {
  checkCancelled(req.signal);
  if (primaryUnconfigured()) {
    logFailover(req, { fallbackUsed: true, failureCategory: 'primary_unconfigured', retryCount: 0 });
    for await (const chunk of fallbackProvider().streamText(req)) { checkCancelled(req.signal); yield chunk; }
    return;
  }
  let last: unknown;
  for (let attempt = 0; attempt <= config.llm.primaryRetries; attempt++) {
    checkCancelled(req.signal);
    let emitted = false;
    const started = Date.now();
    try {
      for await (const chunk of primaryProvider().streamText(req)) { checkCancelled(req.signal); if (chunk) emitted = true; yield chunk; }
      logger.info('[llm] generation completed', { requestId: req.debug?.requestId ?? null, finalProvider: config.llm.primary.provider, finalModel: config.llm.primary.model, fallbackUsed: false, latencyMs: Date.now() - started, retryCount: attempt });
      return;
    } catch (error) {
      checkCancelled(req.signal);
      last = error;
      if (emitted || !isRetryable(error)) throw error;
      if (failureCategory(error) !== 'rate_limit' && attempt < config.llm.primaryRetries) { await abortable(delay(attempt), req.signal); continue; }
      break;
    }
  }
  if (!isRetryable(last)) throw last;
  checkCancelled(req.signal);
  const started = Date.now();
  logFailover(req, { fallbackUsed: true, failureCategory: failureCategory(last), retryCount: config.llm.primaryRetries });
  for await (const chunk of fallbackProvider().streamText(req)) { checkCancelled(req.signal); yield chunk; }
  logger.info('[llm] generation completed', { requestId: req.debug?.requestId ?? null, finalProvider: config.llm.fallback.provider, finalModel: config.llm.fallback.model, fallbackUsed: true, latencyMs: Date.now() - started, retryCount: config.llm.primaryRetries });
}

/** Embeddings remain Gemini-backed so RAG snapshots and query vectors are unchanged. */
export function embedTexts(texts: string[], taskType: EmbedTaskType, options?: { signal?: AbortSignal; deadlineAt?: number }): Promise<number[][]> {
  if (!config.gemini.apiKey) throw new Error('Gemini embedding provider is not configured.');
  checkCancelled(options?.signal);
  return abortable(createGeminiProvider(config.gemini.model).embed(texts, taskType, options), options?.signal);
}
/** Test seam; production construction remains private to this module. */
export function __setProvidersForTests(primaryOverride: LLMProvider | null, fallbackOverride: LLMProvider | null): void {
  primary = primaryOverride;
  fallback = fallbackOverride;
}
export type { StructuredRequest, StreamRequest, EmbedTaskType } from './provider/types.js';
