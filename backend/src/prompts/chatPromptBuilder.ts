/**
 * Chat prompt builder (versioned).
 *
 * chat-v2 (Sprint 2 RAG): consumes a {@link ResolvedContext} — business identity
 * + owner instructions + RETRIEVED knowledge chunks. The assistant answers ONLY
 * from the retrieved knowledge (no hardcoded facts), honoring owner instructions.
 */
import type { ChatMessage } from '../types.js';
import type { ResolvedContext } from '../context/types.js';
import { renderInstructions, renderKnowledge, renderSiteLinks } from './shared.js';

export interface BuiltChatPrompt {
  system: string;
  messages: ChatMessage[];
}

export const chatPromptBuilder = {
  version: 'chat-v2',

  /**
   * @param context - resolved RAG context (identity, instructions, chunks, links).
   * @param messages - prior conversation turns, starting with a user turn.
   * @param summary - optional NL summary of current visitor behaviour.
   * @param opener - optional opening line already shown (seeded popup message).
   */
  build(context: ResolvedContext, messages: ChatMessage[], summary?: string, opener?: string): BuiltChatPrompt {
    const system = [
      `You are the AI sales employee for ${context.business.name}, chatting live with a website visitor.`,
      renderInstructions(context.instructions),
      '',
      renderKnowledge(context.chunks),
      renderSiteLinks(context.siteLinks),
      opener ? `\nYou already opened this conversation by saying: "${opener}". Do not repeat it — continue naturally from the visitor's reply.` : '',
      '',
      'Guidelines:',
      '- Be concise, warm, and genuinely helpful. Answer the question first.',
      '- Answer ONLY from the BUSINESS KNOWLEDGE above. If it does not contain the answer, say so honestly and',
      '  offer to connect the visitor with the team — do NOT guess or invent details.',
      '- Only discuss this business and its services. Politely steer off-topic questions back.',
      '- Keep replies to a few short sentences unless asked for detail.',
      summary ? `\nContext on what this visitor was doing before chatting: ${summary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return { system, messages };
  },
};
