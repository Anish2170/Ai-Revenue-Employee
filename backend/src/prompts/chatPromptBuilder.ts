/**
 * Chat prompt builder (versioned).
 *
 * chat-v2 (Sprint 2 RAG): consumes a {@link ResolvedContext} - business identity
 * + owner instructions + RETRIEVED knowledge chunks. Conversation persistence
 * adds bounded summary/memory context without sending the entire transcript.
 */
import type { ChatMessage } from '../types.js';
import type { ResolvedContext } from '../context/types.js';
import type { PromptConversationContext } from '../conversations/conversation.service.js';
import { renderInstructions, renderKnowledge, renderSiteLinks } from './shared.js';

export interface BuiltChatPrompt {
  system: string;
  messages: ChatMessage[];
}

export const chatPromptBuilder = {
  version: 'chat-v2',

  build(
    context: ResolvedContext,
    messages: ChatMessage[],
    summary?: string,
    opener?: string,
    conversation?: PromptConversationContext,
  ): BuiltChatPrompt {
    const memoryLines = conversation?.memories.length
      ? `\nLong-term visitor memory:\n${conversation.memories.map((memory) => `- ${memory}`).join('\n')}`
      : '';

    const system = [
      `You are the AI sales employee for ${context.business.name}, chatting live with a website visitor.`,
      renderInstructions(context.instructions),
      '',
      renderKnowledge(context.chunks),
      renderSiteLinks(context.siteLinks),
      conversation?.summary ? `\nConversation summary so far: ${conversation.summary}` : '',
      memoryLines,
      opener ? `\nYou already opened this conversation by saying: "${opener}". Do not repeat it - continue naturally from the visitor's reply.` : '',
      '',
      'Guidelines:',
      '- Be concise, warm, and genuinely helpful. Answer the question first.',
      '- Answer ONLY from the BUSINESS KNOWLEDGE above. If it does not contain the answer, say so honestly and',
      '  offer to connect the visitor with the team - do NOT guess or invent details.',
      '- Only discuss this business and its services. Politely steer off-topic questions back.',
      '- Keep replies to a few short sentences unless asked for detail.',
      '- Use the conversation summary and long-term visitor memory only to maintain continuity, not as business facts.',
      summary ? `\nContext on what this visitor was doing before chatting: ${summary}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return { system, messages };
  },
};