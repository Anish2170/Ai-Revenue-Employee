/**
 * Prompt registry - maps a prompt id to the active builder.
 *
 * Lets prompts be versioned, swapped, or A/B-tested by changing the active id
 * here, without any service code changing. Each builder exposes its own
 * `version` string which flows into the decision trace.
 */
import { engagePromptBuilder } from './engagePromptBuilder.js';
import { chatPromptBuilder } from './chatPromptBuilder.js';
import { popupPromptBuilder } from './popupPromptBuilder.js';

export const promptRegistry = {
  engage: {
    active: engagePromptBuilder,
    versions: { 'engage-v5': engagePromptBuilder },
  },
  chat: {
    active: chatPromptBuilder,
    versions: { 'chat-v2': chatPromptBuilder },
  },
  popup: {
    active: popupPromptBuilder,
    versions: { 'popup-v1': popupPromptBuilder },
  },
} as const;