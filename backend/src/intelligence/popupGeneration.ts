/**
 * Popup Generation (Sprint 4.2 component 7).
 *
 * This is the final backend-only handoff object after response validation. It
 * does not render UI and does not talk to the widget. A popup artifact can only
 * be produced from validated LLM language; every failed prior stage suppresses.
 */
import type { ConversationStrategy, StrategyCtaIntent } from './conversationStrategy.js';
import type { PopupResponseRejectReason, PopupResponseValidationResult, ValidatedPopupLanguage } from './responseValidation.js';

export interface GeneratedPopup extends ValidatedPopupLanguage {
  /** Confirms this was produced after deterministic validation, not raw LLM output. */
  source: 'validated_llm';
  /** Strategy metadata for logs/debugging; not visitor-facing copy. */
  strategy: ConversationStrategy['kind'];
  ctaIntent: StrategyCtaIntent;
}

export type PopupGenerationRejectReason = 'response_validation_failed';

export type PopupGenerationResult =
  | {
      ok: true;
      popup: GeneratedPopup;
      suppressed: false;
      reason: null;
    }
  | {
      ok: false;
      popup: null;
      suppressed: true;
      reason: PopupGenerationRejectReason;
      validationReasons: PopupResponseRejectReason[];
    };

export interface PopupGenerationInput {
  validation: PopupResponseValidationResult;
  strategy: ConversationStrategy;
}

export function generatePopup(input: PopupGenerationInput): PopupGenerationResult {
  if (!input.validation.ok) {
    return {
      ok: false,
      popup: null,
      suppressed: true,
      reason: 'response_validation_failed',
      validationReasons: input.validation.reasons,
    };
  }

  return {
    ok: true,
    popup: {
      ...input.validation.popup,
      source: 'validated_llm',
      strategy: input.strategy.kind,
      ctaIntent: input.strategy.ctaIntent,
    },
    suppressed: false,
    reason: null,
  };
}
