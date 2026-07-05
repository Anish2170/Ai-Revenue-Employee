/**
 * Server-side visitor session store (§3.5).
 *
 * Sprint 1 trusted client-sent counters (see the note in rules/rulesEngine.ts).
 * Sprint 4 moves that state HERE — the server owns the rolling semantic-event
 * window and the interruption counters, keyed by an anonymous first-party
 * session id the widget generates.
 *
 * Implementation is an in-memory Map for the dev-fallback path (mirrors the
 * vectorstore's dev-singleton pattern). The interface is deliberately small so
 * a Prisma/Redis-backed store can drop in behind it later with no route changes.
 *
 * Privacy (§10.1): the session id is a random opaque token, NOT identity. We
 * store semantic events only — never PII, never raw coordinates.
 */
import type { SemanticEvent } from '../types.js';

/** Mutable per-visitor state the perception loop needs across event batches. */
export interface VisitorSession {
  /** Opaque anonymous session id (widget-generated). */
  id: string;
  /** Tenant this session belongs to (siteId), or null in the dev-fallback path. */
  siteId: string | null;
  /** Rolling window of accepted semantic events (bounded). */
  events: SemanticEvent[];
  /** Distinct event kinds seen so far (for cross-batch sequence checks). */
  seenKinds: Set<string>;
  /** Interruptions spent this session (§7.3 fatigue). */
  priorInterruptions: number;
  /** Monotonic ms of the last interruption, or null. */
  lastInterruptionTs: number | null;
  /** Whether the visitor explicitly dismissed us (§7.4). */
  dismissed: boolean;
  /** Returning visitor (first-party token present). */
  returning: boolean;
  /** Classified as a bot — short-circuits all future perception for this session. */
  bot: boolean;
  /** Wall-clock ms of last activity (for eviction). */
  updatedAt: number;
}

/** Max events retained per session (older ones have decayed to irrelevance anyway). */
const MAX_EVENTS = 200;
/** Idle TTL before a session is evicted (ms). */
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min
/** Hard cap on concurrent sessions in the in-memory store (dev safety). */
const MAX_SESSIONS = 10_000;

/**
 * Minimal store contract. The route depends on this, not the implementation —
 * so the in-memory version can be swapped for a persistent one later.
 */
export interface SessionStore {
  get(id: string): VisitorSession | undefined;
  getOrCreate(id: string, init: { siteId: string | null; returning: boolean }): VisitorSession;
  /** Append accepted events (bounded) and refresh activity. */
  appendEvents(id: string, events: SemanticEvent[]): void;
  /** Record that we interrupted at `ts` (spends budget, resets cooldown). */
  recordInterruption(id: string, ts: number): void;
  markDismissed(id: string): void;
  markBot(id: string): void;
  /** Current session count (for diagnostics/metrics). */
  size(): number;
}

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, VisitorSession>();

  get(id: string): VisitorSession | undefined {
    const s = this.sessions.get(id);
    if (s && this.isExpired(s)) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  getOrCreate(id: string, init: { siteId: string | null; returning: boolean }): VisitorSession {
    const existing = this.get(id);
    if (existing) return existing;

    this.evictIfNeeded();
    const session: VisitorSession = {
      id,
      siteId: init.siteId,
      events: [],
      seenKinds: new Set(),
      priorInterruptions: 0,
      lastInterruptionTs: null,
      dismissed: false,
      returning: init.returning,
      bot: false,
      updatedAt: nowWall(),
    };
    this.sessions.set(id, session);
    return session;
  }

  appendEvents(id: string, events: SemanticEvent[]): void {
    const s = this.get(id);
    if (!s) return;
    for (const e of events) {
      s.events.push(e);
      s.seenKinds.add(e.type);
    }
    if (s.events.length > MAX_EVENTS) {
      s.events.splice(0, s.events.length - MAX_EVENTS);
    }
    s.updatedAt = nowWall();
  }

  recordInterruption(id: string, ts: number): void {
    const s = this.get(id);
    if (!s) return;
    s.priorInterruptions += 1;
    s.lastInterruptionTs = ts;
    s.updatedAt = nowWall();
  }

  markDismissed(id: string): void {
    const s = this.get(id);
    if (!s) return;
    s.dismissed = true;
    s.updatedAt = nowWall();
  }

  markBot(id: string): void {
    const s = this.get(id);
    if (!s) return;
    s.bot = true;
    s.updatedAt = nowWall();
  }

  size(): number {
    return this.sessions.size;
  }

  private isExpired(s: VisitorSession): boolean {
    return nowWall() - s.updatedAt > SESSION_TTL_MS;
  }

  /** Evict the oldest sessions when at capacity (crude LRU by updatedAt). */
  private evictIfNeeded(): void {
    if (this.sessions.size < MAX_SESSIONS) return;
    let oldestId: string | null = null;
    let oldest = Infinity;
    for (const [id, s] of this.sessions) {
      if (s.updatedAt < oldest) {
        oldest = s.updatedAt;
        oldestId = id;
      }
    }
    if (oldestId) this.sessions.delete(oldestId);
  }
}

function nowWall(): number {
  return Date.now();
}

/** Dev-singleton store (same pattern as the prisma/vectorstore singletons). */
const globalForSessions = globalThis as unknown as { visitorSessions?: SessionStore };
export const sessionStore: SessionStore = globalForSessions.visitorSessions ?? new InMemorySessionStore();
if (process.env.NODE_ENV !== 'production') globalForSessions.visitorSessions = sessionStore;
