/**
 * Popup LLM Adapter (Sprint 4.2 component 5).
 *
 * Provider-independent adapter for popup language generation. It calls the
 * existing LLM facade only after the deterministic pre-LLM safety gate has
 * passed. The returned object is still untrusted; Response Validation is the
 * next Sprint 4.2 component.
 */
import { generateDecision, llmAvailable } from '../llm/index.js';
import type { StructuredRequest } from '../llm/index.js';
import type { BuiltPopupPrompt } from '../prompts/popupPromptBuilder.js';
import type { PreLlmSafetyResult } from './safetyLayer.js';

export type PopupLlmRejectReason = 'safety_rejected' | 'provider_unavailable' | 'timeout' | 'provider_error';

export interface PopupLlmInput {
  prompt: BuiltPopupPrompt;
  safety: PreLlmSafetyResult;
}

export interface PopupLlmOptions {
  /** Default keeps proactive popup generation snappy and fail-closed. */
  timeoutMs?: number;
  /** Test seam; production uses the provider-independent LLM facade. */
  generateStructured?: (req: StructuredRequest) => Promise<unknown>;
  /** Test seam for missing-provider behavior. */
  available?: () => boolean;
}

export type PopupLlmResult =
  | {
      ok: true;
      raw: unknown;
      promptVersion: BuiltPopupPrompt['version'];
    }
  | {
      ok: false;
      reason: PopupLlmRejectReason;
      promptVersion: BuiltPopupPrompt['version'];
      detail?: string;
    };

const DEFAULT_TIMEOUT_MS = 8_000;

export async function generatePopupLanguage(
  input: PopupLlmInput,
  opts: PopupLlmOptions = {},
): Promise<PopupLlmResult> {
  if (!input.safety.ok) {
    return {
      ok: false,
      reason: 'safety_rejected',
      promptVersion: input.prompt.version,
      detail: input.safety.reasons.join(','),
    };
  }

  const available = opts.available ?? llmAvailable;
  if (!available()) {
    return { ok: false, reason: 'provider_unavailable', promptVersion: input.prompt.version };
  }

  const generateStructured = opts.generateStructured ?? generateDecision;
  const req: StructuredRequest = {
    system: input.prompt.system,
    user: input.prompt.user,
    schema: input.prompt.schema,
  };

  try {
    const raw = await withTimeout(generateStructured(req), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    return { ok: true, raw, promptVersion: input.prompt.version };
  } catch (err) {
    if (err instanceof PopupLlmTimeoutError) {
      return { ok: false, reason: 'timeout', promptVersion: input.prompt.version };
    }
    const detail = err instanceof Error ? err.message : 'Unknown provider error';
    return { ok: false, reason: 'provider_error', promptVersion: input.prompt.version, detail };
  }
}

class PopupLlmTimeoutError extends Error {
  constructor() {
    super('Popup LLM generation timed out.');
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PopupLlmTimeoutError()), Math.max(0, timeoutMs));
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}