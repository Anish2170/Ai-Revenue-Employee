/**
 * Engage prompt builder (versioned).
 *
 * engage-v5 (Sprint 2 RAG): consumes a {@link ResolvedContext} — business
 * identity + owner instructions + the RETRIEVED knowledge chunks (not hardcoded
 * fields) + navigable site links. The model leads with a specific, grounded
 * value nugget from the retrieved knowledge, then offers help, honoring the
 * owner's instructions (tone / always-book-demo / avoid-discounts / language).
 */
import type { VisitorBehaviour } from '../types.js';
import type { ResolvedContext } from '../context/types.js';
import type { PreGateResult } from '../rules/rulesEngine.js';
import { engageJsonSchema, MAX_MESSAGE_LENGTH } from '../validation/engageSchema.js';
import { renderInstructions, renderKnowledge, renderSiteLinks } from './shared.js';

export interface BuiltEngagePrompt {
  system: string;
  user: string;
  schema: typeof engageJsonSchema;
}

export const engagePromptBuilder = {
  version: 'engage-v5',

  /**
   * @param context - resolved RAG context (identity, instructions, chunks, links).
   * @param behaviour - the summarized visitor snapshot.
   * @param summary - deterministic NL summary of `behaviour`.
   * @param rules - output of the pre-LLM gate (signals/score).
   */
  build(
    context: ResolvedContext,
    behaviour: VisitorBehaviour,
    summary: string,
    rules: PreGateResult,
  ): BuiltEngagePrompt {
    const system = [
      `You are the proactive AI sales employee for ${context.business.name}.`,
      renderInstructions(context.instructions),
      '',
      renderKnowledge(context.chunks),
      renderSiteLinks(context.siteLinks),
      '',
      'YOUR TASK: Decide whether NOW is the right moment to proactively open a popup for this visitor.',
      'If yes, write ONE short popup message that LEADS WITH VALUE — a specific, relevant fact or a direct',
      'answer to the question the visitor most likely has right now, based on the exact page they are on and',
      'what they did. THEN add a brief offer to help. Give them something genuinely useful first; do NOT just',
      'ask "can I help you?".',
      '',
      'RULES:',
      '- Ground every claim ONLY in the BUSINESS KNOWLEDGE above. NEVER invent prices, features, numbers, or guarantees.',
      '- If the knowledge above does not contain something concretely useful for this visitor, prefer showPopup=false.',
      `- message: one or two sentences, under ${MAX_MESSAGE_LENGTH} characters, conversational and specific.`,
      '',
      'CHOOSING THE BUTTON (be deliberate):',
      '- Most popups should simply invite a chat. A navigation button is the EXCEPTION, not the default — use it sparingly.',
      '- Only set ctaUrl when sending the visitor to a DIFFERENT, more relevant page is clearly the best next step.',
      "- NEVER set ctaUrl to the page the visitor is already on (compare against 'page' below). If the most relevant page",
      '  IS their current page, leave ctaUrl EMPTY and use a discussion label like "Discuss pricing" so the button opens chat.',
      '- cta: a short button label under 40 chars. If navigating, name the destination ("Book a demo"). If opening chat, invite discussion.',
      '- ctaUrl: empty, OR an EXACT copy of one entry from "Site links" above. Never invent/modify a url, and never reuse the current page.',
      '- intent: a short snake_case label (e.g. pricing_interest, service_research, ready_to_book).',
      '- confidence: your 0–1 certainty that engaging now genuinely helps this visitor.',
      '- Respond ONLY as JSON matching the provided schema. No prose, no markdown.',
    ]
      .filter(Boolean)
      .join('\n');

    const user = [
      'Visitor behaviour summary:',
      summary,
      '',
      'Raw signals (for reference):',
      `- page: ${behaviour.page}`,
      `- pageTitle: ${behaviour.pageTitle}`,
      `- timeOnPage: ${behaviour.timeOnPage}s`,
      `- scrollDepth: ${behaviour.scrollDepth}%`,
      `- clickedElements: ${behaviour.clickedElements.join(', ') || 'none'}`,
      `- formInteracted: ${behaviour.formInteracted}`,
      `- exitIntent: ${behaviour.exitIntent}`,
      '',
      `Engagement signals detected by rules engine: ${rules.signals.join(', ') || 'none'} (score ${rules.score}).`,
      '',
      'Write the value-first decision as JSON.',
    ].join('\n');

    return { system, user, schema: engageJsonSchema };
  },
};
