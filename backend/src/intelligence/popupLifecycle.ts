import { randomUUID } from 'node:crypto';
import type { VisitorSession } from './session/visitorSession.js';
import { sessionStore } from './session/visitorSession.js';
import { SALES_POLICY } from './config/salesPolicy.config.js';
import { sessionCooldownRemainingMs } from './popupTrace.js';
import { popupFingerprint, repeatsPopup, type PopupContent, type PopupFingerprint } from './popupRepetition.js';

export const POPUP_LIFECYCLE = { generationMs: 12_000, candidateMs: 15_000, claimMs: 3_000, maxAttempts: 6, minAttemptGapMs: 5_000 } as const;
export interface PopupContext { pageInstanceId: string; pageStartedAt: number; version: number; blockedReason?: string | null; formStalled?: boolean }
export interface PopupDeliveryMetadata { version: 2; popupId: string; decisionId: string; pageInstanceId: string; contextVersion: number; expiresAt: number; formAssistance: boolean }
export interface PopupCandidate {
  content?: PopupFingerprint;
  rejectionReason?: 'duplicate_content';
  id: string;
  pageInstanceId: string;
  contextVersion: number;
  decisionTs: number;
  status: 'generating' | 'pending' | 'claimed' | 'displayed' | 'released' | 'expired' | 'failed';
  controller: AbortController;
  expiresAt: number;
  claimUntil?: number;
  /** Unknown display consumes a conservative slot, not a fabricated display. */
  unconfirmedClaim: boolean;
  clicked?: boolean;
  dismissed?: boolean;
}
export interface PopupLifecycleState {
  context: PopupContext;
  retiredPages: string[];
  candidates: PopupCandidate[];
  retryAt: number;
  failures: number;
}

function state(session: VisitorSession, context: PopupContext): PopupLifecycleState {
  return session.popupLifecycle ??= { context: { ...context }, retiredPages: [], candidates: [], retryAt: 0, failures: 0 };
}
function expire(life: PopupLifecycleState, now = Date.now()): void {
  for (const candidate of life.candidates) {
    if (['generating', 'pending', 'claimed'].includes(candidate.status) && candidate.expiresAt <= now) {
      candidate.status = 'expired';
      candidate.controller.abort(new Error('Popup candidate expired'));
      // A missing display receipt cannot prove that a claimed popup was unseen.
    }
  }
}

/** Synchronous mutations are atomic within ONE JS process; no replica claim. */
export function observePopupContext(session: VisitorSession, context: PopupContext): boolean {
  const life = state(session, context);
  expire(life);
  const old = life.context;
  if (context.pageInstanceId !== old.pageInstanceId) {
    if (context.pageStartedAt < old.pageStartedAt || life.retiredPages.includes(context.pageInstanceId)) return false;
    life.retiredPages.push(old.pageInstanceId);
    life.retiredPages = life.retiredPages.slice(-32);
  } else if (context.version < old.version) return false;
  const changed = context.pageInstanceId !== old.pageInstanceId || context.version !== old.version || Boolean(context.blockedReason);
  life.context = { ...context };
  if (context.blockedReason === 'converted') session.conversionCompleted = true;
  if (changed) for (const candidate of life.candidates) {
    if (candidate.status === 'generating' || candidate.status === 'pending') {
      if (candidate.status === 'generating') life.retryAt = Math.max(life.retryAt, candidate.expiresAt);
      candidate.status = 'released';
      candidate.controller.abort(new Error('Popup context changed'));
    }
  }
  return true;
}

export function reservePopup(session: VisitorSession, context: PopupContext, decisionTs: number): { candidate?: PopupCandidate; reason?: string } {
  if (!observePopupContext(session, context)) return { reason: 'stale_context' };
  const life = session.popupLifecycle!;
  if (context.blockedReason) return { reason: context.blockedReason };
  if (session.conversionCompleted) return { reason: 'converted' };
  if (session.dismissed || session.bot) return { reason: session.dismissed ? 'dismissed' : 'bot' };
  const uncertain = life.candidates.filter(c => c.unconfirmedClaim).length;
  if (session.priorInterruptions + uncertain >= SALES_POLICY.maxInterruptionsPerSession) return { reason: 'frequency_budget' };
  if (sessionCooldownRemainingMs(session, decisionTs, SALES_POLICY.cooldownMs) > 0) return { reason: 'cooldown' };
  if (life.candidates.some(c => ['generating', 'pending', 'claimed'].includes(c.status))) return { reason: 'candidate_pending' };
  if (Date.now() < life.retryAt) return { reason: 'generation_backoff' };
  if (life.candidates.length >= POPUP_LIFECYCLE.maxAttempts) return { reason: 'generation_budget' };
  const candidate: PopupCandidate = { id: randomUUID(), pageInstanceId: context.pageInstanceId, contextVersion: context.version, decisionTs,
    status: 'generating', controller: new AbortController(), expiresAt: Date.now() + POPUP_LIFECYCLE.generationMs, unconfirmedClaim: false };
  life.candidates.push(candidate);
  life.retryAt = Date.now() + POPUP_LIFECYCLE.minAttemptGapMs;
  return { candidate };
}

export function completePopup(session: VisitorSession, candidate: PopupCandidate, copy?: PopupContent): boolean {
  const life = session.popupLifecycle;
  if (!life) return false;
  expire(life);
  if (candidate.status !== 'generating' || candidate.controller.signal.aborted || life.context.blockedReason || life.context.pageInstanceId !== candidate.pageInstanceId || life.context.version !== candidate.contextVersion) return false;
  if (copy) {
    candidate.content = popupFingerprint(copy);
    if (life.candidates.some(prior => prior !== candidate && (prior.status === 'displayed' || prior.unconfirmedClaim)
      && prior.content && repeatsPopup(prior.content, candidate.content!))) {
      candidate.status = 'released'; candidate.rejectionReason = 'duplicate_content';
      candidate.controller.abort(new Error('Repeated popup content'));
      return false;
    }
  }
  candidate.status = 'pending';
  candidate.expiresAt = Date.now() + POPUP_LIFECYCLE.candidateMs;
  life.failures = 0;
  return true;
}

export function failPopup(session: VisitorSession, candidate: PopupCandidate): void {
  const life = session.popupLifecycle;
  if (!life || candidate.status !== 'generating') return;
  const wasCancelled = candidate.controller.signal.aborted;
  candidate.status = 'failed';
  candidate.controller.abort(new Error('Popup generation failed'));
  life.retryAt = Math.max(life.retryAt, Date.now() + Math.min(30_000, 5_000 * 2 ** life.failures++));
  if (wasCancelled) life.retryAt = Math.max(life.retryAt, candidate.expiresAt);
}

export type PopupOperation = 'claim' | 'displayed' | 'release' | 'clicked' | 'dismissed';
export function transitionPopup(session: VisitorSession, id: string, pageInstanceId: string, operation: PopupOperation, context?: PopupContext): { ok: boolean; changed: boolean; candidate?: PopupCandidate } {
  const life = session.popupLifecycle;
  if (!life) return { ok: false, changed: false };
  expire(life);
  const candidate = life.candidates.find(c => c.id === id && c.pageInstanceId === pageInstanceId);
  if (!candidate) return { ok: false, changed: false };
  if (operation === 'claim') {
    if (!context || !observePopupContext(session, context) || context.blockedReason || context.pageInstanceId !== candidate.pageInstanceId || context.version !== candidate.contextVersion) return { ok: false, changed: false };
    if (candidate.status === 'claimed') return { ok: Date.now() < candidate.claimUntil!, changed: false, candidate };
    if (candidate.status !== 'pending' || session.dismissed || session.bot || session.conversionCompleted) return { ok: false, changed: false };
    if (session.priorInterruptions + life.candidates.filter(c => c.unconfirmedClaim).length >= SALES_POLICY.maxInterruptionsPerSession || sessionCooldownRemainingMs(session, session.latestEventTs ?? candidate.decisionTs, SALES_POLICY.cooldownMs) > 0) return { ok: false, changed: false };
    candidate.status = 'claimed';
    candidate.unconfirmedClaim = true;
    candidate.claimUntil = Math.min(candidate.expiresAt, Date.now() + POPUP_LIFECYCLE.claimMs);
    // Even lost acknowledgements cannot result in rapid repeated display offers.
    life.retryAt = Math.max(life.retryAt, Date.now() + SALES_POLICY.cooldownMs);
    return { ok: true, changed: true, candidate };
  }
  if (operation === 'release') {
    if (candidate.status === 'displayed') return { ok: false, changed: false };
    const changed = candidate.status !== 'released' || candidate.unconfirmedClaim;
    candidate.status = 'released'; candidate.unconfirmedClaim = false;
    candidate.controller.abort(new Error('Popup not rendered'));
    return { ok: true, changed, candidate };
  }
  if (operation === 'displayed') {
    if (candidate.status === 'displayed') return { ok: true, changed: false, candidate };
    // A delayed receipt for an expired CLAIM is valid; never for an unclaimed artifact.
    if (!candidate.unconfirmedClaim || !['claimed', 'expired'].includes(candidate.status)) return { ok: false, changed: false };
    candidate.unconfirmedClaim = false; candidate.status = 'displayed';
    sessionStore.recordInterruption(session.id, Math.max(candidate.decisionTs, session.latestEventTs ?? 0));
    return { ok: true, changed: true, candidate };
  }
  if (candidate.status !== 'displayed') return { ok: false, changed: false };
  const key = operation === 'clicked' ? 'clicked' : 'dismissed';
  const changed = !candidate[key]; candidate[key] = true;
  if (operation === 'dismissed') sessionStore.markDismissed(session.id);
  return { ok: true, changed, candidate };
}
