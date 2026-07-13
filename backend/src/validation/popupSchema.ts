/**
 * Sprint 4.2 popup language schema.
 *
 * This is intentionally NOT an interruption-decision schema. The deterministic
 * Sales Brain already decided to speak before this schema is used. The LLM may
 * only generate visitor-facing language fields.
 */
export const MAX_POPUP_TITLE_LENGTH = 80;
export const MAX_POPUP_BODY_LENGTH = 320;
export const MAX_POPUP_ACTION_ID_LENGTH = 64;

export const POPUP_TYPES = ['educational', 'comparison', 'pricing', 'trust', 'booking', 'lead', 'support'] as const;
export type PopupType = (typeof POPUP_TYPES)[number];

export const POPUP_TONES = ['helpful', 'consultative', 'reassuring', 'direct', 'supportive'] as const;
export type PopupTone = (typeof POPUP_TONES)[number];

export const popupJsonSchema = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: `Short popup title, maximum ${MAX_POPUP_TITLE_LENGTH} characters.`,
    },
    body: {
      type: 'string',
      description: `One or two grounded sentences, maximum ${MAX_POPUP_BODY_LENGTH} characters.`,
    },
    primaryAction: {
      type: 'string',
      description: 'Optional Action ID chosen only from Available Actions. Empty when no listed action fits.',
    },
    secondaryAction: {
      type: 'string',
      description: 'Optional secondary Action ID chosen only from Available Actions.',
    },
    tone: {
      type: 'string',
      enum: POPUP_TONES,
      description: 'Tone used in the generated popup language.',
    },
    popupType: {
      type: 'string',
      enum: POPUP_TYPES,
      description: 'Popup category matching the approved conversation strategy.',
    },
  },
  required: ['title', 'body', 'tone', 'popupType'],
} as const;