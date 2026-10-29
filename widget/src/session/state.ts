/**
 * Widget-owned session state.
 *
 * Sprint 1 has no server-side session store, so the widget is the source of
 * truth for cooldown/frequency/dedup counters and sends them to the backend on
 * every /engage call. Persisted in sessionStorage and bound to the server-issued
 * session so counters survive navigation but never leak into a different visit.
 * Default navigation resets the per-page shown flag; dismissal and counters stay.
 */
import type { SessionState } from '../types.js';

const KEY = 'aire_session_v2';

const empty: SessionState = {
  popupShown: false,
  lastEngageAt: null,
  engageCount: 0,
  dismissed: false,
};

export class SessionManager {
  private state: SessionState = { ...empty };
  private sessionId: string | null = null;

  constructor(private readonly siteId: string) {}

  /** Counters belong to the signed visit, never to a previous tab session. */
  bind(sessionId: string): void {
    if (this.sessionId === sessionId) return;
    this.sessionId = sessionId;
    this.state = this.load();
    this.persist();
  }

  get(): SessionState {
    return { ...this.state };
  }

  /** Record a successfully inserted popup (display cooldown + frequency). */
  markEngaged(): void {
    this.state.engageCount += 1;
    this.state.lastEngageAt = Date.now();
    this.persist();
  }

  markPopupShown(): void {
    this.state.popupShown = true;
    this.persist();
  }

  markDismissed(): void {
    this.state.dismissed = true;
    this.persist();
  }

  /** A page change permits a new candidate, but never revokes a dismissal. */
  resetForPage(): void {
    this.state.popupShown = false;
    this.persist();
  }

  private load(): SessionState {
    try {
      const raw = sessionStorage.getItem(`${KEY}:${this.siteId}`);
      if (raw) {
        const saved = JSON.parse(raw) as { sessionId: string; state: SessionState };
        if (saved.sessionId === this.sessionId) return { ...empty, ...saved.state, popupShown: false };
      }
    } catch {
      /* storage blocked (private mode / sandbox) — fall back to memory */
    }
    return { ...empty };
  }

  private persist(): void {
    try {
      if (this.sessionId) sessionStorage.setItem(`${KEY}:${this.siteId}`, JSON.stringify({ sessionId: this.sessionId, state: this.state }));
    } catch {
      /* ignore */
    }
  }
}
