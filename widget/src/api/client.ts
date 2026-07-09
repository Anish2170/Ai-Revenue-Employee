/**
 * Backend API client. The only place the widget talks to the network.
 */
import type {
  ChatConversationMeta,
  ChatMessage,
  ChatSource,
  EngageDecision,
  SessionState,
  VisitorBehaviour,
  WidgetConfig,
  WidgetConversationResponse,
} from '../types.js';
import { getSessionId, getVisitorId } from '../sensors/session.js';

export class ApiClient {
  constructor(private readonly cfg: WidgetConfig) {}

  async postEngage(behaviour: VisitorBehaviour, session: SessionState): Promise<EngageDecision> {
    try {
      const res = await fetch(`${this.cfg.backendUrl}/engage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: this.cfg.siteId, behaviour, session }),
      });
      if (!res.ok) return { showPopup: false };
      return (await res.json()) as EngageDecision;
    } catch {
      return { showPopup: false };
    }
  }

  async restoreConversation(behaviour: VisitorBehaviour, conversationId?: string | null): Promise<WidgetConversationResponse | null> {
    return this.postConversationEndpoint('/conversations/restore', { behaviour, conversationId: conversationId || undefined });
  }

  async createConversation(behaviour: VisitorBehaviour, opener?: string): Promise<WidgetConversationResponse | null> {
    return this.postConversationEndpoint('/conversations', { behaviour, opener });
  }

  async getConversation(conversationId: string): Promise<WidgetConversationResponse | null> {
    try {
      const params = new URLSearchParams({ siteId: this.cfg.siteId, visitorId: getVisitorId() });
      const res = await fetch(`${this.cfg.backendUrl}/conversations/${conversationId}?${params.toString()}`);
      if (!res.ok) return null;
      return (await res.json()) as WidgetConversationResponse;
    } catch {
      return null;
    }
  }

  private async postConversationEndpoint(path: string, extra: Record<string, unknown>): Promise<WidgetConversationResponse | null> {
    try {
      const res = await fetch(`${this.cfg.backendUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: this.cfg.siteId, visitorId: getVisitorId(), sessionId: getSessionId(), ...extra }),
      });
      if (!res.ok) return null;
      return (await res.json()) as WidgetConversationResponse;
    } catch {
      return null;
    }
  }

  streamChat(
    messages: ChatMessage[],
    behaviour: VisitorBehaviour | undefined,
    conversationId: string | null,
    handlers: { onConversation?: (conversation: ChatConversationMeta) => void; onToken: (t: string) => void; onSource?: (source: ChatSource) => void; onError: (m: string) => void; onDone: () => void },
  ): () => void {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${this.cfg.backendUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: this.cfg.siteId, conversationId: conversationId || undefined, visitorId: getVisitorId(), sessionId: getSessionId(), messages, behaviour }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          handlers.onError('Unable to reach the assistant.');
          handlers.onDone();
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const line = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') {
              handlers.onDone();
              return;
            }
            try {
              const obj = JSON.parse(payload) as { conversation?: ChatConversationMeta; token?: string; source?: ChatSource; error?: string };
              if (obj.error) handlers.onError(obj.error);
              else if (obj.conversation) handlers.onConversation?.(obj.conversation);
              else if (obj.token) handlers.onToken(obj.token);
              else if (obj.source) handlers.onSource?.(obj.source);
            } catch {
              /* ignore malformed frame */
            }
          }
        }
        handlers.onDone();
      } catch (err) {
        if ((err as Error)?.name !== 'AbortError') handlers.onError('The connection was interrupted.');
        handlers.onDone();
      }
    })();

    return () => controller.abort();
  }
}