/**
 * Backend API client. The only place the widget talks to the network.
 *
 * - postEngage: JSON request/response.
 * - streamChat: POSTs the conversation and parses the SSE token stream from the
 *   fetch ReadableStream, invoking callbacks as tokens arrive.
 */
import type { ChatMessage, ChatSource, EngageDecision, SessionState, VisitorBehaviour, WidgetConfig } from '../types.js';

export class ApiClient {
  constructor(private readonly cfg: WidgetConfig) {}

  /** Ask the backend whether/how to engage. Never throws — returns no-popup on failure. */
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

  /**
   * Stream a chat reply. Calls `onToken` for each text chunk, `onError` once on
   * failure, and `onDone` when the stream ends. Returns an abort function.
   */
  streamChat(
    messages: ChatMessage[],
    behaviour: VisitorBehaviour | undefined,
    handlers: { onToken: (t: string) => void; onSource?: (source: ChatSource) => void; onError: (m: string) => void; onDone: () => void },
  ): () => void {
    const controller = new AbortController();

    (async () => {
      try {
        const res = await fetch(`${this.cfg.backendUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ siteId: this.cfg.siteId, messages, behaviour }),
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

          // SSE frames are separated by a blank line.
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
              const obj = JSON.parse(payload) as { token?: string; source?: ChatSource; error?: string };
              if (obj.error) handlers.onError(obj.error);
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
