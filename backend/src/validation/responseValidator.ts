/**
 * Response Validator — never trust raw LLM output.
 *
 * Validates, coerces/clamps, and sanitizes whatever the model returned into a
 * safe {@link EngageDecision}. Any failure degrades to { showPopup: false } so
 * the widget can never be broken by malformed or hostile model output.
 *
 * Security note: `message`/`cta` are rendered into the host page's DOM by the
 * widget as textContent (never innerHTML). We additionally strip control chars
 * and angle brackets here as defense-in-depth.
 */
import type { EngageDecision } from '../types.js';
import { findBusinessAction } from '../business-actions/action.service.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import {
  MAX_CTA_LENGTH,
  MAX_MESSAGE_LENGTH,
  engageDecisionZod,
} from './engageSchema.js';

const SAFE_FALLBACK: EngageDecision = { showPopup: false };

/** Remove control characters and angle brackets, collapse whitespace, trim. */
function sanitizeText(input: string): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeActionId(input: string | undefined): string | null {
  if (!input) return null;
  const clean = sanitizeText(input).slice(0, 80);
  return /^[a-z][a-z0-9_]{1,63}$/.test(clean) ? clean : null;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Resolve the LLM's chosen CTA url against the site's allowlist.
 *
 * SECURITY: we only accept a url that EXACTLY matches one the site itself
 * provided. This makes open-redirects, `javascript:`/`data:` URIs, and links to
 * arbitrary external domains impossible — the model cannot navigate a visitor
 * anywhere the site owner didn't explicitly list.
 *
 * @returns the safe url, or undefined to fall back to opening chat.
 */
/** Normalize a path/url to a comparable lowercase pathname without trailing slash. */
function normalizePath(input: string): string {
  let p = input.trim();
  try {
    p = new URL(p, 'http://x').pathname;
  } catch {
    /* keep as-is */
  }
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

function resolveCtaUrl(
  raw: string | undefined,
  allowedUrls: string[],
  currentPath: string,
): string | undefined {
  if (!raw) return undefined;
  const candidate = raw.trim();
  if (!allowedUrls.includes(candidate)) return undefined;
  // Don't navigate a visitor to the page they're already on — that CTA should
  // open the chat instead (the widget falls back to chat when ctaUrl is absent).
  if (currentPath && normalizePath(candidate) === normalizePath(currentPath)) return undefined;
  return candidate;
}

/**
 * Validate and sanitize a raw model decision (already parsed from JSON).
 *
 * @param raw - the parsed object returned by the LLM.
 * @param allowedUrls - the site's allowlisted navigation targets (from context).
 * @param currentPath - the page the visitor is currently on (to avoid self-nav).
 * @returns a safe decision; { showPopup: false } if anything is off.
 */
export function validateEngageDecision(
  raw: unknown,
  allowedUrls: string[] = [],
  currentPath = '',
  enabledActions: BusinessActionConfig[] = [],
): EngageDecision {
  const parsed = engageDecisionZod.safeParse(raw);
  if (!parsed.success) return SAFE_FALLBACK;

  const d = parsed.data;

  if (!d.showPopup) return { showPopup: false };

  const message = sanitizeText(d.message ?? '').slice(0, MAX_MESSAGE_LENGTH);
  const legacyCta = sanitizeText(d.cta ?? '').slice(0, MAX_CTA_LENGTH);
  const primaryActionId = sanitizeActionId(d.primaryAction);
  const secondaryActionId = sanitizeActionId(d.secondaryAction);
  const primaryAction = findBusinessAction(enabledActions, primaryActionId);
  const secondaryAction = findBusinessAction(enabledActions, secondaryActionId);

  // A "show" decision is only meaningful with real copy to render.
  if (message.length === 0) return SAFE_FALLBACK;

  const ctaUrl = resolveCtaUrl(d.ctaUrl, allowedUrls, currentPath);

  return {
    showPopup: true,
    intent: d.intent ? sanitizeText(d.intent).slice(0, 60) : 'engagement',
    confidence: clamp01(d.confidence ?? 0),
    message,
    ...(primaryAction ? { primaryAction: primaryAction.actionId, action: primaryAction, cta: primaryAction.label } : {}),
    ...(secondaryAction ? { secondaryAction: secondaryAction.actionId } : {}),
    ...(!primaryAction && legacyCta ? { cta: legacyCta } : {}),
    ...(!primaryAction && ctaUrl ? { ctaUrl } : {}),
  };
}
