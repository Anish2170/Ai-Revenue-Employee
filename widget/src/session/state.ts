/**
 * Widget-owned session state.
 *
 * Sprint 1 has no server-side session store, so the widget is the source of
 * truth for cooldown/frequency/dedup counters and sends them to the backend on
 * every /engage call. Persisted in sessionStorage so it survives in-tab soft
 * navigations. On a new page, the per-page flags (popupShown/dismissed) reset so
 * each page gets a fresh chance, while cumulative counters persist for the cap.
 */
import type { SessionState } from '../types.js';

const KEY = 'aire_session_v1';

const empty: SessionState = {
  popupShown: false,
  lastEngageAt: null,
  engageCount: 0,
  dismissed: false,
};

export class SessionManager {
  private state: SessionState;

  constructor() {
    this.state = this.load();
  }

  get(): SessionState {
    return { ...this.state };
  }

  /** Record that an /engage evaluation just happened (cooldown + frequency). */
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

  /** Reset per-page flags on navigation; keep cumulative counters. */
  resetForPage(): void {
    this.state.popupShown = false;
    this.state.dismissed = false;
    this.persist();
  }

  private load(): SessionState {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) return { ...empty, ...(JSON.parse(raw) as Partial<SessionState>) };
    } catch {
      /* storage blocked (private mode / sandbox) — fall back to memory */
    }
    return { ...empty };
  }

  private persist(): void {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* ignore */
    }
  }
}
