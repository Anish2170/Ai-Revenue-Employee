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
  const suffix = detail === undefined ? '' : ` ${JSON.stringify(detail)}`;
  console.log(`[chat:${id}] ${stage}${suffix}`);
}
export function createGeminiProvider(): LLMProvider {
  const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const model = config.gemini.model;

  return {
    id: `gemini:${model}`,

    async generateStructured(req: StructuredRequest): Promise<unknown> {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: req.user }] }],
        config: {
          systemInstruction: req.system,
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(req.schema),
          temperature: 0.4,
        },
      });

      const text = response.text;
      if (!text) throw new Error('Gemini returned an empty structured response');
      return JSON.parse(stripFences(text));
    },

    async *streamText(req: StreamRequest): AsyncIterable<string> {
      let raw = '';
      try {
        chatTrace(req, 'LLM request', {
          provider: `gemini:${model}`,
          messages: req.messages.length,
          systemChars: req.system.length,
        });

        const stream = await ai.models.generateContentStream({
          model,
          contents: toGeminiContents(req.messages),
          config: {
            systemInstruction: req.system,
            temperature: 0.6,
          },
        });

        for await (const chunk of stream) {
          const text = chunk.text;
          if (text) {
            raw += text;
            chatTrace(req, 'raw Gemini chunk', { chars: text.length, text });
            yield text;
          }
        }

        chatTrace(req, 'raw Gemini response', { chars: raw.length, text: raw });
      } catch (err) {
        console.error(`[chat:${req.debug?.requestId ?? 'no-request-id'}] Gemini provider error`, serializeProviderError(err));
        throw err;
      }
    },

    async embed(texts: string[], taskType: EmbedTaskType): Promise<number[][]> {
      if (texts.length === 0) return [];
      const embeddingModel = config.gemini.embeddingModel;
      const taskTypeStr = geminiTaskType(taskType);
      const BATCH = 100;
      const out: number[][] = [];

      const embedOne = async (text: string): Promise<number[]> => {
        const res = await ai.models.embedContent({
          model: embeddingModel,
          contents: text,
          config: { taskType: taskTypeStr },
        });
        return res.embeddings?.[0]?.values ?? [];
      };

      for (let i = 0; i < texts.length; i += BATCH) {
        const batch = texts.slice(i, i + BATCH);
        try {
          const res = await ai.models.embedContent({
            model: embeddingModel,
            contents: batch,
            config: { taskType: taskTypeStr },
          });
          const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
          if (vectors.length !== batch.length) throw new Error('embedding count mismatch');
          out.push(...vectors);
        } catch {
          // Per-item fallback so one bad input doesn't fail the whole batch.
          for (const text of batch) out.push(await embedOne(text));
        }
      }
      return out;
    },
  };
}




