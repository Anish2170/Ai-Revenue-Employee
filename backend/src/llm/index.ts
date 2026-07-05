/**
 * LLM facade — the domain-facing entry point to the LLM layer.
 *
 * Exposes two intention-revealing methods (`generateDecision`, `streamChat`)
 * that services call. Internally it selects a provider implementing the generic
 * {@link LLMProvider} port. To switch from Gemini to OpenAI/Anthropic/Grok,
 * change only `selectProvider()` — services never change.
 */
import { hasLLM } from '../config/index.js';
import { createGeminiProvider } from './provider/gemini.js';
import type {
  EmbedTaskType,
  LLMProvider,
  StreamRequest,
  StructuredRequest,
} from './provider/types.js';

let provider: LLMProvider | null = null;

function selectProvider(): LLMProvider {
  if (!hasLLM) {
    throw new Error('No LLM provider configured (missing GEMINI_API_KEY).');
  }
  if (!provider) {
    provider = createGeminiProvider(); // swap here to change provider
  }
  return provider;
}

/** Whether an LLM provider is available to call. */
export function llmAvailable(): boolean {
  return hasLLM;
}

/** Generate a single structured engagement decision (untrusted, validate after). */
export function generateDecision(req: StructuredRequest): Promise<unknown> {
  return selectProvider().generateStructured(req);
}

/** Stream a chat completion as text chunks. */
export function streamChat(req: StreamRequest): AsyncIterable<string> {
  return selectProvider().streamText(req);
}

/** Embed texts into vectors (document or query mode) for the RAG engine. */
export function embedTexts(texts: string[], taskType: EmbedTaskType): Promise<number[][]> {
  return selectProvider().embed(texts, taskType);
}

export type { StructuredRequest, StreamRequest, EmbedTaskType } from './provider/types.js';
