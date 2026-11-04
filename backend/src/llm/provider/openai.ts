import { config } from '../../config/index.js';
import type { EmbedTaskType, LLMProvider, StreamRequest, StructuredRequest } from './types.js';
import { LLMTimeoutError } from './errors.js';
import { abortable, checkCancelled, deadlineScope } from '../cancellation.js';
import { logger } from '../../logging/logger.js';

const endpoint = 'https://api.openai.com/v1/chat/completions';

function messages(req: StreamRequest | StructuredRequest) {
  const conversation = 'messages' in req ? req.messages : [{ role: 'user' as const, content: req.user }];
  return [{ role: 'system', content: req.system }, ...conversation];
}
function usage(req: StreamRequest | StructuredRequest, value: any, model: string): void {
  if (!value || !Number.isFinite(value.prompt_tokens) || !Number.isFinite(value.completion_tokens)) return;
  try { req.onUsage?.({ provider: 'openai', model, inputTokens: value.prompt_tokens, outputTokens: value.completion_tokens,
    cachedInputTokens: value.prompt_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: value.prompt_tokens_details?.cache_write_tokens ?? 0,
    reasoningTokens: value.completion_tokens_details?.reasoning_tokens ?? 0 }); }
  catch { logger.warn('[llm] usage observer failed'); }
}

async function request(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  checkCancelled(signal);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.connectionTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal,
      headers: { Authorization: `Bearer ${config.llm.primary.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const error = new Error(`OpenAI request failed with status ${response.status}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    clearTimeout(timer);
    return response;
  } catch (error) {
    checkCancelled(signal);
    if (controller.signal.aborted) throw new LLMTimeoutError('OpenAI connection timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

export function createOpenAIProvider(): LLMProvider {
  const model = config.llm.primary.model;
  // Luna defaults to medium reasoning, which is incompatible with temperature.
  // Keep routine chat/JSON generation fast while preserving other model overrides.
  const reasoningOptions = model === 'gpt-6-luna' || model.startsWith('gpt-6-luna-')
    ? { reasoning_effort: 'none' as const }
    : {};
  return {
    id: `openai:${model}`,
    async generateStructured(req) {
      const timeout = Math.min(config.llm.responseTimeoutMs, req.deadlineAt === undefined ? Infinity : req.deadlineAt - Date.now());
      const scope = deadlineScope(req.signal, timeout);
      try {
        const response = await abortable(request({ model, ...reasoningOptions, messages: messages(req), temperature: 0.4, ...(req.maxOutputTokens ? { max_completion_tokens: req.maxOutputTokens } : {}), response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: req.schema } } }, scope.signal), scope.signal);
        const body = await abortable(response.json(), scope.signal) as { usage?: unknown; choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };
        usage(req, body.usage, model);
        if (body.choices?.[0]?.finish_reason === 'length') throw new Error('OpenAI structured response was truncated');
        checkCancelled(scope.signal);
        const text = body.choices?.[0]?.message?.content;
        if (!text) throw new Error('OpenAI returned an empty structured response');
        return JSON.parse(text);
      } finally { scope.close(); }
    },
    async *streamText(req) {
      const response = await request({ model, ...reasoningOptions, messages: messages(req), temperature: 0.6, stream: true,
        ...(req.onUsage ? { stream_options: { include_usage: true } } : {}), ...(req.maxOutputTokens ? { max_completion_tokens: req.maxOutputTokens } : {}) }, req.signal);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('OpenAI returned no stream body');
      const decoder = new TextDecoder(); let buffer = '', truncated = false, completed = false;
      const deadline = Date.now() + config.llm.responseTimeoutMs;
      try {
        while (true) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new LLMTimeoutError('OpenAI response timed out.');
          const timeout = Math.min(remaining, config.llm.streamInactivityTimeoutMs);
          const next = await abortable(new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new LLMTimeoutError(timeout === remaining ? 'OpenAI response timed out.' : 'OpenAI stream became inactive.')), timeout);
            reader.read().then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
          }), req.signal);
          if (next.done) throw new Error('OpenAI stream ended before completion');
          buffer += decoder.decode(next.value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) if (line.startsWith('data: ')) {
            const data = line.slice(6).trim(); if (data === '[DONE]') { completed = true; if (truncated) throw new Error('OpenAI response was truncated'); return; }
            const parsed = JSON.parse(data) as { usage?: unknown; choices?: Array<{ finish_reason?: string; delta?: { content?: string } }> };
            usage(req, parsed.usage, model);
            if (parsed.choices?.[0]?.finish_reason === 'length') truncated = true;
            const text = parsed.choices?.[0]?.delta?.content; if (text) yield text;
          }
        }
      } finally { if (!completed) void reader.cancel().catch(() => undefined); reader.releaseLock(); }
    },
    async embed(_texts: string[], _taskType: EmbedTaskType): Promise<number[][]> { throw new Error('OpenAI is not configured for embeddings.'); },
  };
}
