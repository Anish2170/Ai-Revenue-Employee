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
export type WidgetIdentity = { visitorId: string; sessionId: string; visitorToken: string; expiresAt: number };
const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { window.clearTimeout(timeout); }
}

export class ApiClient {
  private identityPromise: Promise<WidgetIdentity | null> | null = null;
  constructor(private readonly cfg: WidgetConfig) {}

  private identity(): Promise<WidgetIdentity | null> {
    if (this.identityPromise) return this.identityPromise;
    this.identityPromise = (async () => {
      const key = `aire_widget_identity:${this.cfg.siteId}`;
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as WidgetIdentity | null;
        if (saved && saved.expiresAt > Date.now()) return saved;
        const res = await fetchWithTimeout(`${this.cfg.backendUrl}/widget/session`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteId: this.cfg.siteId }) });
        if (!res.ok) return null;
        const identity = await res.json() as WidgetIdentity;
        localStorage.setItem(key, JSON.stringify(identity));
        return identity;
      } catch { return null; }
    })();
    return this.identityPromise;
  }

  /** The one server-issued anonymous identity shared by all widget transports. */
  getIdentity(): Promise<WidgetIdentity | null> {
    return this.identity();
  }

  async postEngage(behaviour: VisitorBehaviour, session: SessionState): Promise<EngageDecision> {
    try {
      const identity = await this.identity(); if (!identity) return { showPopup: false };
      const res = await fetchWithTimeout(`${this.cfg.backendUrl}/engage`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: this.cfg.siteId,
          visitorId: identity.visitorId,
          sessionId: identity.sessionId,
          visitorToken: identity.visitorToken,
          behaviour,
          session,
        }),
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
      const identity = await this.identity(); if (!identity) return null;
      const params = new URLSearchParams({ siteId: this.cfg.siteId, visitorId: identity.visitorId, visitorToken: identity.visitorToken });
      const res = await fetchWithTimeout(`${this.cfg.backendUrl}/conversations/${conversationId}?${params.toString()}`, { credentials: 'omit' });
      if (!res.ok) return null;
      return (await res.json()) as WidgetConversationResponse;
    } catch {
      return null;
    }
  }

  private async postConversationEndpoint(path: string, extra: Record<string, unknown>): Promise<WidgetConversationResponse | null> {
    try {
      const identity = await this.identity(); if (!identity) return null;
      const res = await fetchWithTimeout(`${this.cfg.backendUrl}${path}`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: this.cfg.siteId, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: identity.visitorToken, ...extra }),
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
        const identity = await this.identity(); if (!identity) { handlers.onError('Unable to start the assistant.'); handlers.onDone(); return; }
        // Do not apply a short request timeout to streaming: token generation may legitimately take longer.
        const res = await fetch(`${this.cfg.backendUrl}/chat`, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: this.cfg.siteId, conversationId: conversationId || undefined, visitorId: identity.visitorId, sessionId: identity.sessionId, visitorToken: identity.visitorToken, messages, behaviour }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          handlers.onError(res.status === 429 ? 'You\'re doing that a little too quickly. Please try again in a moment.' : 'The AI is temporarily unavailable. Please try again.');
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
              if (obj.error) handlers.onError('The AI is temporarily unavailable. Please try again.');
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
        if ((err as Error)?.name !== 'AbortError') handlers.onError('The connection was interrupted. Please try again.');
        handlers.onDone();
      }
    })();

    return () => controller.abort();
  }
}
