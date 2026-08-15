import { config } from '../../config/index.js';
import type { EmbedTaskType, LLMProvider, StreamRequest, StructuredRequest } from './types.js';
import { LLMTimeoutError } from './errors.js';

const endpoint = 'https://api.openai.com/v1/chat/completions';

function messages(req: StreamRequest | StructuredRequest) {
  const conversation = 'messages' in req ? req.messages : [{ role: 'user' as const, content: req.user }];
  return [{ role: 'system', content: req.system }, ...conversation];
}

async function request(body: Record<string, unknown>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.llm.connectionTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', signal: controller.signal,
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
    if (controller.signal.aborted) throw new LLMTimeoutError('OpenAI connection timed out.');
    throw error;
  } finally { clearTimeout(timer); }
}

export function createOpenAIProvider(): LLMProvider {
  const model = config.llm.primary.model;
  return {
    id: `openai:${model}`,
    async generateStructured(req) {
      const response = await request({ model, messages: messages(req), temperature: 0.4, response_format: { type: 'json_schema', json_schema: { name: 'result', strict: true, schema: req.schema } } });
      const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const text = body.choices?.[0]?.message?.content;
      if (!text) throw new Error('OpenAI returned an empty structured response');
      return JSON.parse(text);
    },
    async *streamText(req) {
      const response = await request({ model, messages: messages(req), temperature: 0.6, stream: true });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('OpenAI returned no stream body');
      const decoder = new TextDecoder(); let buffer = '';
      const deadline = Date.now() + config.llm.responseTimeoutMs;
      try {
        while (true) {
          const remaining = deadline - Date.now();
          if (remaining <= 0) throw new LLMTimeoutError('OpenAI response timed out.');
          const timeout = Math.min(remaining, config.llm.streamInactivityTimeoutMs);
          const next = await new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new LLMTimeoutError(timeout === remaining ? 'OpenAI response timed out.' : 'OpenAI stream became inactive.')), timeout);
            reader.read().then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
          });
          if (next.done) return;
          buffer += decoder.decode(next.value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) if (line.startsWith('data: ')) {
            const data = line.slice(6).trim(); if (data === '[DONE]') return;
            const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
            const text = parsed.choices?.[0]?.delta?.content; if (text) yield text;
          }
        }
      } finally { reader.releaseLock(); }
    },
    async embed(_texts: string[], _taskType: EmbedTaskType): Promise<number[][]> { throw new Error('OpenAI is not configured for embeddings.'); },
  };
}
