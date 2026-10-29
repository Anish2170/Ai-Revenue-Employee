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
import { abortable, checkCancelled, deadlineScope } from '../llm/cancellation.js';

export type PopupLlmRejectReason = 'safety_rejected' | 'provider_unavailable' | 'timeout' | 'cancelled' | 'provider_error';

export interface PopupLlmInput {
  prompt: BuiltPopupPrompt;
  safety: PreLlmSafetyResult;
}

export interface PopupLlmOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
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
  const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.deadlineAt === undefined ? Infinity : opts.deadlineAt - Date.now());
  const scope = deadlineScope(opts.signal, timeoutMs);
  const req: StructuredRequest = {
    signal: scope.signal,
    deadlineAt: Math.min(opts.deadlineAt ?? Infinity, Date.now() + timeoutMs),
    system: input.prompt.system,
    user: input.prompt.user,
    schema: input.prompt.schema,
  };

  try {
    checkCancelled(scope.signal);
    const raw = await abortable(generateStructured(req), scope.signal);
    return { ok: true, raw, promptVersion: input.prompt.version };
  } catch (err) {
    if (scope.signal.aborted) {
      if (opts.signal?.aborted) return { ok: false, reason: 'cancelled', promptVersion: input.prompt.version };
      return { ok: false, reason: 'timeout', promptVersion: input.prompt.version };
    }
    const detail = err instanceof Error ? err.message : 'Unknown provider error';
    return { ok: false, reason: 'provider_error', promptVersion: input.prompt.version, detail };
  } finally { scope.close(); }
}
