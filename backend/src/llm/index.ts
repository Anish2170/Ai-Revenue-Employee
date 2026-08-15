/** Provider-neutral LLM facade: primary generation with Gemini failover; Gemini embeddings. */
import { config, hasLLM } from '../config/index.js';
import { logger } from '../logging/logger.js';
import { createGeminiProvider } from './provider/gemini.js';
import { createOpenAIProvider } from './provider/openai.js';
import { failureCategory, isRetryable } from './provider/errors.js';
import type { EmbedTaskType, LLMProvider, StreamRequest, StructuredRequest } from './provider/types.js';

let primary: LLMProvider | null = null;
let fallback: LLMProvider | null = null;

function primaryProvider(): LLMProvider {
  if (primary) return primary;
  if (!hasLLM || !config.llm.primary.apiKey) throw new Error('Primary LLM provider is not configured.');
  if (config.llm.primary.provider !== 'openai') throw new Error(`Unsupported PRIMARY_LLM_PROVIDER: ${config.llm.primary.provider}`);
  return primary ??= createOpenAIProvider();
}
function fallbackProvider(): LLMProvider {
  if (fallback) return fallback;
  if (!config.gemini.apiKey) throw new Error('Gemini fallback is not configured.');
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

export async function generateDecision(req: StructuredRequest): Promise<unknown> {
  let last: unknown;
  for (let attempt = 0; attempt <= config.llm.primaryRetries; attempt++) {
    try { return await primaryProvider().generateStructured(req); }
    catch (error) { last = error; if (!isRetryable(error) || failureCategory(error) === 'rate_limit' || attempt === config.llm.primaryRetries) break; await delay(attempt); }
  }
  if (!isRetryable(last)) throw last;
  logFailover(req, { fallbackUsed: true, failureCategory: failureCategory(last), retryCount: config.llm.primaryRetries });
  return fallbackProvider().generateStructured(req);
}

export async function* streamChat(req: StreamRequest): AsyncIterable<string> {
  let last: unknown;
  for (let attempt = 0; attempt <= config.llm.primaryRetries; attempt++) {
    let emitted = false;
    const started = Date.now();
    try {
      for await (const chunk of primaryProvider().streamText(req)) { if (chunk) emitted = true; yield chunk; }
      logger.info('[llm] generation completed', { requestId: req.debug?.requestId ?? null, finalProvider: config.llm.primary.provider, finalModel: config.llm.primary.model, fallbackUsed: false, latencyMs: Date.now() - started, retryCount: attempt });
      return;
    } catch (error) {
      last = error;
      if (emitted || !isRetryable(error)) throw error;
      if (failureCategory(error) !== 'rate_limit' && attempt < config.llm.primaryRetries) { await delay(attempt); continue; }
      break;
    }
  }
  if (!isRetryable(last)) throw last;
  const started = Date.now();
  logFailover(req, { fallbackUsed: true, failureCategory: failureCategory(last), retryCount: config.llm.primaryRetries });
  for await (const chunk of fallbackProvider().streamText(req)) yield chunk;
  logger.info('[llm] generation completed', { requestId: req.debug?.requestId ?? null, finalProvider: config.llm.fallback.provider, finalModel: config.llm.fallback.model, fallbackUsed: true, latencyMs: Date.now() - started, retryCount: config.llm.primaryRetries });
}

/** Embeddings remain Gemini-backed so RAG snapshots and query vectors are unchanged. */
export function embedTexts(texts: string[], taskType: EmbedTaskType): Promise<number[][]> {
  if (!config.gemini.apiKey) throw new Error('Gemini embedding provider is not configured.');
  return createGeminiProvider(config.gemini.model).embed(texts, taskType);
}
/** Test seam; production construction remains private to this module. */
export function __setProvidersForTests(primaryOverride: LLMProvider | null, fallbackOverride: LLMProvider | null): void {
  primary = primaryOverride;
  fallback = fallbackOverride;
}
export type { StructuredRequest, StreamRequest, EmbedTaskType } from './provider/types.js';
