/**
 * Provider-agnostic LLM port.
 *
 * Any provider (Gemini today; OpenAI / Anthropic / Grok later) implements these
 * two generic primitives. They carry NO business logic â€” domain concerns
 * (which schema, which prompt) live in the services and prompt builders above.
 * Swapping providers means implementing this interface and nothing else.
 */

/** A single conversation turn in provider-neutral terms. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Request for a single structured (JSON) generation. */
export interface StructuredRequest {
  /** System instruction. */
  system: string;
  /** User content. */
  user: string;
  /** Provider-neutral JSON Schema the output must conform to. */
  schema: Record<string, unknown>;
}

/** Request for a streamed chat completion. */
export interface StreamRequest {
  system: string;
  messages: ChatTurn[];
  debug?: {
    requestId?: string;
    pipeline?: string;
  };
}

/**
 * Embedding task type. Providers that distinguish document vs query embeddings
 * (Gemini does) use this to improve retrieval quality.
 */
export type EmbedTaskType = 'document' | 'query';

export interface LLMProvider {
  /** Human-readable provider id, for logging/debug. */
  readonly id: string;

  /**
   * Generate a single JSON object conforming to `schema`.
   * @returns the parsed object (still untrusted â€” caller must validate).
   * @throws if the provider errors or returns unparseable output.
   */
  generateStructured(req: StructuredRequest): Promise<unknown>;

  /**
   * Stream a chat completion as text chunks.
   * @returns an async iterable of token/text deltas.
   */
  streamText(req: StreamRequest): AsyncIterable<string>;

  /**
   * Embed one or more texts into vectors.
   * @param texts - inputs to embed.
   * @param taskType - document (for indexed chunks) or query (for searches).
   * @returns one vector per input, in order.
   * @throws if the provider errors.
   */
  embed(texts: string[], taskType: EmbedTaskType): Promise<number[][]>;
}


