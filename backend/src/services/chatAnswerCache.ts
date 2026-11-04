import { createHash } from 'node:crypto';
import { config } from '../config/index.js';
import { getWebsiteStore } from '../vectorstore/registry.js';
import type { ChatStreamInput, ChatStreamEvent } from './chatService.js';
import type { ChatIntent } from '../language/chatConversation.js';
import type { ChatLanguageState } from '../language/chatLanguage.js';
import { normalizeFactQuery } from '../context/factQuery.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const entries = new Map<string, { expires: number; events: ChatStreamEvent[] }>();
export function clearChatAnswerCache(): void { entries.clear(); }
/** Public, standalone factual questions only. Never reuse a visitor's personal
 * reply, follow-up, memory, source-attribution request, or missing-data fallback. */
export async function chatCacheKey(input: ChatStreamInput, intent: ChatIntent, language: ChatLanguageState): Promise<string | null> {
  const users = input.messages.filter(m => m.role === 'user');
  const canonical = (text: string) => normalizeFactQuery(text).replace(/[?!।]+$/u, '').replace(/\s+/gu, ' ').trim();
  const query = users.at(-1)?.content ?? '';
  if (!config.chat.cacheEnabled || !input.tenant || intent.kind !== 'factual' || intent.contextual
    || input.allowLeadInvitation || input.conversation?.summary || input.conversation?.memories.length
    || !users.length || users.some(m => canonical(m.content) !== canonical(query))) return null;
  if (query.length > 240 || /\b(?:my|mine|i|me|mera|meri|mujhe|today|tomorrow|aaj|kal|this|that|it|these|those|source|sources)\b|मेरा|मेरी|मुझे|आज|कल|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\d{5,}/iu.test(query)) return null;
  const { store, meta } = await getWebsiteStore(input.tenant.websiteId, { requireFreshVersion: true });
  if (!store.size() || meta && new URL(meta.sourceUrl).origin !== new URL(input.tenant.instructions.websiteUrl!).origin) return null;
  // Hash actual source text as well as version, so invalidation also works for
  // legacy snapshots and in-process updates. Never log/cache embeddings or queries.
  const version = hash(store.export().map(({ embedding, ...document }) => document));
  return hash({ websiteId: input.tenant.websiteId, sourceUrl: meta?.sourceUrl, version,
    instructions: input.tenant.instructions, actions: input.tenant.businessActions ?? [], language,
    query: canonical(query),
    page: input.behaviour?.page ?? '', opener: input.messages.slice(0, input.messages.findIndex(m => m.role === 'user')),
    models: [config.llm.primary.model, config.llm.fallback.model], prompt: 'natural-chat-v1' });
}
export function readChatAnswer(key: string | null): ChatStreamEvent[] | null {
  if (!key) return null;
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) { entries.delete(key); return null; }
  entries.delete(key); entries.set(key, entry);
  return structuredClone(entry.events);
}
export function saveChatAnswer(key: string | null, events: ChatStreamEvent[]): void {
  if (!key) return;
  for (const [id, entry] of entries) if (entry.expires <= Date.now()) entries.delete(id);
  if (entries.size >= config.chat.cacheMaxEntries) entries.delete(entries.keys().next().value!);
  entries.set(key, { expires: Date.now() + config.chat.cacheTtlMs, events: structuredClone(events) });
}
