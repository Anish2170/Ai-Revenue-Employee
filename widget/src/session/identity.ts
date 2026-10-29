/** Visitor proof is persistent; active identity belongs to this tab's visit. */
import type { WidgetConfig } from '../types.js';

export type WidgetIdentity = {
  visitorId: string;
  sessionId: string;
  visitorToken: string;
  expiresAt: number;
  sessionStartedAt: number;
  returning: boolean;
};

type SignedIdentity = Pick<WidgetIdentity, 'visitorId' | 'sessionId' | 'visitorToken' | 'expiresAt'>;
type VisitorProof = Omit<SignedIdentity, 'sessionId'>;
type IdentityConfig = Pick<WidgetConfig, 'siteId' | 'backendUrl'>;
type SavedSession = { identity: WidgetIdentity; lastSeenAt: number };
const IDLE_MS = 30 * 60 * 1000;
// The backend accepts session-relative semantic timestamps up to six hours.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const pages = new Map<string, Promise<SavedSession | null>>();
const active = new Map<string, SavedSession>();
const proofs = new Map<string, VisitorProof>();
const retryAfter = new Map<string, number>();
const RETRY_DELAY_MS = 500;

function scope(cfg: IdentityConfig): string { return `${cfg.backendUrl}:${cfg.siteId}`; }
function visitorKey(cfg: IdentityConfig): string { return `aire_widget_visitor_v2:${scope(cfg)}`; }
function sessionKey(cfg: IdentityConfig): string { return `aire_widget_session_v2:${scope(cfg)}`; }

function read(store: 'localStorage' | 'sessionStorage', key: string): unknown {
  try { return JSON.parse(globalThis[store].getItem(key) ?? 'null'); } catch { return null; }
}
function write(store: 'localStorage' | 'sessionStorage', key: string, value: unknown): void {
  try { globalThis[store].setItem(key, JSON.stringify(value)); } catch { /* memory-only when storage is unavailable */ }
}
function visitorProof(value: unknown): value is VisitorProof {
  if (!value || typeof value !== 'object') return false;
  const item = value as VisitorProof;
  return [item.visitorId, item.visitorToken].every(part => typeof part === 'string' && part.length > 0)
    && typeof item.expiresAt === 'number' && Number.isFinite(item.expiresAt) && item.expiresAt > Date.now();
}
function signedIdentity(value: unknown): value is SignedIdentity {
  return visitorProof(value) && typeof (value as SignedIdentity).sessionId === 'string' && (value as SignedIdentity).sessionId.length > 0;
}
function savedSession(value: unknown): value is SavedSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as SavedSession;
  const now = Date.now();
  return signedIdentity(item.identity) && typeof item.identity.returning === 'boolean'
    && Number.isFinite(item.identity.sessionStartedAt) && item.identity.sessionStartedAt <= now
    && now - item.identity.sessionStartedAt < MAX_AGE_MS
    && Number.isFinite(item.lastSeenAt) && item.lastSeenAt <= now && now - item.lastSeenAt < IDLE_MS;
}

/** All transports share one visit; stale visits renew before the next request. */
export async function getWidgetIdentity(
  cfg: WidgetConfig,
  request: (input: string, init: RequestInit) => Promise<Response>,
): Promise<WidgetIdentity | null> {
  const key = scope(cfg);
  // At most one stale-cache refresh per caller; malformed/near-expiry replies
  // cannot recurse forever. Failures share a short backoff across transports.
  for (let attempt = 0; attempt < 2; attempt++) {
    let pending = pages.get(key);
    if (!pending) {
      if (Date.now() < (retryAfter.get(key) ?? 0)) return null;
      pending = bootstrap(cfg, request);
      pages.set(key, pending);
    }
    const saved = await pending.catch(() => null);
    if (!saved) {
      if (pages.get(key) === pending) {
        pages.delete(key); active.delete(key);
        retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
      }
      return null;
    }
    const resumeIdentity = saved.identity;
    if (!savedSession(saved)) {
      if (visitorProof(resumeIdentity)) proofs.set(key, resumeIdentity);
      active.delete(key);
      if (pages.get(key) === pending) pages.delete(key);
      continue;
    }
    active.set(key, saved);
    proofs.set(key, saved.identity);
    retryAfter.delete(key);
    saved.lastSeenAt = Date.now();
    write('sessionStorage', sessionKey(cfg), saved);
    return saved.identity;
  }
  retryAfter.set(key, Date.now() + RETRY_DELAY_MS);
  return null;
}

function availableLocks(): LockManager | undefined {
  try { return globalThis.navigator?.locks; } catch { return undefined; }
}

/** A copied sessionStorage (duplicate/opener tab) must not join a live tab. */
async function claimSession(cfg: WidgetConfig, sessionId: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  const locks = availableLocks();
  if (!locks) return true;
  let release = () => {};
  const acquire = () => new Promise<boolean>(resolve => {
    void locks.request(`aire_widget_tab:${scope(cfg)}:${sessionId}`, { ifAvailable: true, signal }, lock => {
      if (!lock) { resolve(false); return; }
      resolve(true);
      return new Promise<void>(done => { release = done; });
    }).catch(() => resolve(!signal.aborted)); // blocked APIs degrade to sessionStorage isolation
  });
  if (!await acquire()) return false;
  signal.addEventListener('abort', () => release(), { once: true });
  window.addEventListener('pagehide', () => release());
  window.addEventListener('pageshow', event => { if (event.persisted) void acquire(); });
  return true;
}

async function bootstrap(cfg: WidgetConfig, request: (input: string, init: RequestInit) => Promise<Response>): Promise<SavedSession | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof window.setTimeout>;
  const deadline = new Promise<null>(resolve => {
    timer = window.setTimeout(() => { controller.abort(); resolve(null); }, 10_000);
  });
  const work = async () => {
    const locks = availableLocks();
    if (locks) {
      try { return await locks.request(`aire_widget_bootstrap:${scope(cfg)}`, { signal: controller.signal }, () => bootstrapUnlocked(cfg, request, controller.signal)); }
      catch { /* unavailable/blocked locks: keep the widget usable */ }
    }
    return bootstrapUnlocked(cfg, request, controller.signal);
  };
  try { return await Promise.race([work(), deadline]); }
  finally { window.clearTimeout(timer!); }
}

async function bootstrapUnlocked(cfg: WidgetConfig, request: (input: string, init: RequestInit) => Promise<Response>, signal: AbortSignal): Promise<SavedSession | null> {
  if (signal.aborted) return null;
  try {
    const saved = read('sessionStorage', sessionKey(cfg));
    if (savedSession(saved) && await claimSession(cfg, saved.identity.sessionId, signal)) return saved;
    const visitor = read('localStorage', visitorKey(cfg));
    const legacy = read('localStorage', `aire_widget_identity:${cfg.siteId}`);
    const tabVisitor = saved && typeof saved === 'object' ? (saved as SavedSession).identity : null;
    const memory = proofs.get(scope(cfg));
    const previous = visitorProof(visitor) ? visitor : signedIdentity(legacy) ? legacy : visitorProof(tabVisitor) ? tabVisitor : visitorProof(memory) ? memory : null;
    if (previous) proofs.set(scope(cfg), previous);
    const sessionStartedAt = Date.now();
    const res = await request(`${cfg.backendUrl}/widget/session`, {
      method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ siteId: cfg.siteId, ...(previous ? { visitorToken: previous.visitorToken } : {}) }),
    });
    if (!res.ok || signal.aborted) return null;
    const issued: unknown = await res.json();
    if (signal.aborted || !signedIdentity(issued)) return null;
    if (!await claimSession(cfg, issued.sessionId, signal) || signal.aborted) return null;
    const identity: WidgetIdentity = { ...issued, sessionStartedAt, returning: previous?.visitorId === issued.visitorId };
    const result = { identity, lastSeenAt: Date.now() };
    write('localStorage', visitorKey(cfg), { visitorId: issued.visitorId, visitorToken: issued.visitorToken, expiresAt: issued.expiresAt });
    write('sessionStorage', sessionKey(cfg), result);
    return result;
  } catch { return null; }
}

/** Activity extends the tab cache only; the signed visitor expiry never slides. */
export function touchWidgetSession(cfg: IdentityConfig, identity: WidgetIdentity): void {
  const saved = active.get(scope(cfg));
  if (!saved || saved.identity.sessionId !== identity.sessionId) return;
  saved.lastSeenAt = Date.now();
  write('sessionStorage', sessionKey(cfg), saved);
}
