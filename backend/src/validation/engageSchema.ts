/**
 * Single source of truth for the engage decision shape.
 *
 * - `engageDecisionZod` validates LLM output at runtime.
 * - `engageJsonSchema` is the provider-neutral JSON Schema handed to the LLM so
 *   it returns structured JSON. Both are co-located here so they can't drift.
 *
 * The widget-facing `debug` field is intentionally NOT part of the LLM schema —
 * it is assembled by the service, not the model.
 */
import { z } from 'zod';

/** Maximum characters allowed in a popup message (defense + UX).
 *  Sized to fit a specific value nugget + a short offer without truncation. */
export const MAX_MESSAGE_LENGTH = 320;
/** Maximum characters allowed in a CTA label. */
export const MAX_CTA_LENGTH = 40;

/** Runtime validator for the LLM's raw decision (pre-sanitization). */
export const engageDecisionZod = z.object({
  showPopup: z.boolean(),
  intent: z.string().max(60).optional(),
  confidence: z.number().min(0).max(1).optional(),
  message: z.string().max(2000).optional(),
  cta: z.string().max(120).optional(),
  ctaUrl: z.string().max(2048).optional(),
});

export type RawEngageDecision = z.infer<typeof engageDecisionZod>;

/**
 * Provider-neutral JSON Schema describing the same shape, passed to the LLM as a
 * structured-output constraint. Kept deliberately simple (standard JSON Schema
 * keywords) so any provider adapter can translate it.
 */
export const engageJsonSchema = {
  type: 'object',
  properties: {
    showPopup: { type: 'boolean', description: 'Whether to show a proactive popup to this visitor.' },
    intent: { type: 'string', description: 'Short machine label for the visitor intent, e.g. pricing_interest.' },
    confidence: { type: 'number', description: 'Confidence between 0 and 1 that engaging now is the right call.' },
    message: { type: 'string', description: 'The popup body text shown to the visitor. Empty when showPopup is false.' },
    cta: { type: 'string', description: 'Short call-to-action button label. Empty when showPopup is false.' },
    ctaUrl: {
      type: 'string',
      description:
        'Optional. If the best next step is to visit a specific page, set this to the EXACT url of the most relevant entry from the provided Site links list. Only use a url from that list; never invent one. Leave empty to instead open chat.',
    },
  },
  required: ['showPopup', 'intent', 'confidence', 'message', 'cta'],
} as const;
