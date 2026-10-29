/**
 * Gemini implementation of the {@link LLMProvider} port (@google/genai).
 *
 * Translates the provider-neutral requests into Gemini calls:
 * - structured output via responseMimeType + responseSchema
 * - streaming via generateContentStream
 *
 * Gemini uses the role "model" for the assistant; we map from our neutral
 * "assistant" role here so the rest of the app stays provider-agnostic.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { config } from '../../config/index.js';
import type {
  ChatTurn,
  EmbedTaskType,
  LLMProvider,
  StreamRequest,
  StructuredRequest,
} from './types.js';
import { logger } from '../../logging/logger.js';
import { abortable, checkCancelled } from '../cancellation.js';

/** Map our neutral task type to Gemini's embedding taskType enum value. */
function geminiTaskType(t: EmbedTaskType): string {
  return t === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
}

/** Convert a neutral JSON-Schema node into a Gemini Schema node. */
function toGeminiSchema(node: Record<string, unknown>): Record<string, unknown> {
  const type = node.type as string | undefined;
  const out: Record<string, unknown> = {};
  if (node.description) out.description = node.description;

  switch (type) {
    case 'object': {
      out.type = Type.OBJECT;
      const props = (node.properties ?? {}) as Record<string, Record<string, unknown>>;
      out.properties = Object.fromEntries(
        Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]),
      );
      if (Array.isArray(node.required)) out.required = node.required;
      break;
    }
    case 'array':
      out.type = Type.ARRAY;
      if (node.items) out.items = toGeminiSchema(node.items as Record<string, unknown>);
      break;
    case 'string':
      out.type = Type.STRING;
      break;
    case 'number':
      out.type = Type.NUMBER;
      break;
    case 'integer':
      out.type = Type.INTEGER;
      break;
    case 'boolean':
      out.type = Type.BOOLEAN;
      break;
    default:
      out.type = Type.STRING;
  }
  return out;
}

/** Strip ```json fences if a model wraps its JSON despite instructions. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

function toGeminiContents(messages: ChatTurn[]) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
}

function serializeProviderError(err: unknown): Record<string, unknown> {
  if (!(err instanceof Error)) return { value: String(err) };
  const anyErr = err as Error & { status?: unknown; code?: unknown; response?: unknown; cause?: unknown };
  return {
    name: err.name,
    message: err.message,
    status: anyErr.status,
    code: anyErr.code,
    response: anyErr.response,
    cause: anyErr.cause instanceof Error ? { name: anyErr.cause.name, message: anyErr.cause.message } : anyErr.cause,
  };
}

function chatTrace(req: StreamRequest, stage: string, detail?: unknown): void {
  if (!config.debugTrace) return;
  const id = req.debug?.requestId ?? 'no-request-id';
  logger.debug(`[chat:${id}] ${stage}`, detail);
}
export function createGeminiProvider(modelOverride = config.llm.fallback.model): LLMProvider {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const model = modelOverride;
  // Flash-Lite 3.5 ignores sampling parameters and disallows model prefills.
  // Keep older model overrides unchanged; rely on 3.5's default minimal thinking.
  const isFlashLite35 = /^gemini-3\.5-flash-lite(?:-|$)/.test(model.replace(/^models\//, ''));

  return {
    id: `gemini:${model}`,

    async generateStructured(req: StructuredRequest): Promise<unknown> {
      checkCancelled(req.signal);
      const response = await abortable(ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        config: {
          // Installed SDK 0.7 supports HTTP timeout, not external abortSignal.
          httpOptions: { timeout: Math.max(1, Math.min(config.llm.responseTimeoutMs, (req.deadlineAt ?? Date.now() + config.llm.responseTimeoutMs) - Date.now())) },
          systemInstruction: req.system,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(req.schema),
          ...(isFlashLite35 ? {} : { temperature: 0.4 }),
        },
      }), req.signal);
      checkCancelled(req.signal);

      const text = response.text;
      if (!text) throw new Error('Gemini returned an empty structured response');
      return JSON.parse(stripFences(text));
    },

    async *streamText(req: StreamRequest): AsyncIterable<string> {
      let raw = '';
      try {
        checkCancelled(req.signal);
        if (isFlashLite35) {
          const lastNonEmpty = [...req.messages].reverse().find((message) => message.content.trim());
          if (!lastNonEmpty || lastNonEmpty.role !== 'user') {
            // Do not silently discard assistant history or invent a user turn.
            throw new Error('Gemini 3.5 Flash-Lite streaming requires the last non-empty message to be a user turn.');
          }
        }
        chatTrace(req, 'LLM request', {
          provider: `gemini:${model}`,
          messages: req.messages.length,
          systemChars: req.system.length,
        });

        const stream = await abortable(ai.models.generateContentStream({
          model,
          contents: toGeminiContents(req.messages),
          config: {
            systemInstruction: req.system,
            ...(isFlashLite35 ? {} : { temperature: 0.6 }),
          },
        }), req.signal);

        for await (const chunk of stream) {
          checkCancelled(req.signal);
          const text = chunk.text;
          if (text) {
            raw += text;
            chatTrace(req, 'Gemini chunk received', { chars: text.length });
            yield text;
          }
        }

        chatTrace(req, 'Gemini response received', { chars: raw.length });
      } catch (err) {
        logger.error(`[chat:${req.debug?.requestId ?? 'no-request-id'}] Gemini provider error`, serializeProviderError(err));
        throw err;
      }
    },

    async embed(texts: string[], taskType: EmbedTaskType, options?: { signal?: AbortSignal; deadlineAt?: number }): Promise<number[][]> {
      if (texts.length === 0) return [];
      const embeddingModel = config.gemini.embeddingModel;
      const taskTypeStr = geminiTaskType(taskType);
      const BATCH = 100;
      const out: number[][] = [];
      const httpOptions = options ? { timeout: Math.max(1, Math.min(config.llm.responseTimeoutMs, (options.deadlineAt ?? Date.now() + config.llm.responseTimeoutMs) - Date.now())) } : undefined;

      const embedOne = async (text: string): Promise<number[]> => {
        checkCancelled(options?.signal);
        const res = await abortable(ai.models.embedContent({
          model: embeddingModel,
          contents: text,
          config: { taskType: taskTypeStr, ...(httpOptions ? { httpOptions } : {}) },
        }), options?.signal);
        return res.embeddings?.[0]?.values ?? [];
      };

      for (let i = 0; i < texts.length; i += BATCH) {
        checkCancelled(options?.signal);
        const batch = texts.slice(i, i + BATCH);
        try {
          const res = await abortable(ai.models.embedContent({
            model: embeddingModel,
            contents: batch,
            config: { taskType: taskTypeStr, ...(httpOptions ? { httpOptions } : {}) },
          }), options?.signal);
          const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
          if (vectors.length !== batch.length) throw new Error('embedding count mismatch');
          out.push(...vectors);
        } catch {
          checkCancelled(options?.signal);
          // Per-item fallback so one bad input doesn't fail the whole batch.
          for (const text of batch) out.push(await embedOne(text));
        }
      }
      return out;
    },
  };
}




