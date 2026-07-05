/**
 * Anonymous first-party session identity (§3.5, §10.1).
 *
 * - `sessionId`: opaque random token for THIS browsing session (sessionStorage).
 *   It is NOT identity — just a key so the backend can accumulate the event
 *   window server-side.
 * - `returning`: whether a first-party return token exists from a prior visit
 *   (localStorage). Opt-in, rotating, non-identifying.
 *
 * No fingerprinting, no third-party cookies, no cross-site anything.
 */

const SESSION_KEY = 'aire_sid';
const RETURN_KEY = 'aire_rt';

function randomId(): string {
  // 128-bit opaque token; crypto where available, Math.random fallback.
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 12)}`;
}

function safeGet(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(store: Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    /* storage blocked (private mode) — degrade to per-load id */
  }
}

/** Get (or create) the per-session id. Stable within a browser session/tab. */
export function getSessionId(): string {
  const ss = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  const existing = safeGet(ss, SESSION_KEY);
  if (existing) return existing;
  const id = randomId();
  safeSet(ss, SESSION_KEY, id);
  return id;
}

/**
 * Whether this visitor is returning, and mark the return token for next time.
 * Called once at start; the token simply proves "seen before," nothing more.
 */
export function resolveReturning(): boolean {
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  const seen = safeGet(ls, RETURN_KEY) !== null;
  safeSet(ls, RETURN_KEY, randomId()); // rotate on every visit
  return seen;
}
