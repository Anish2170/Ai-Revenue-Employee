/**
 * Response Validation (Sprint 4.2 component 6).
 *
 * Validates raw popup language from the LLM adapter before any visitor-facing
 * rendering can exist. Business action destinations are never accepted from the
 * model; optional action IDs must match the enabled business configuration.
 */
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import { findBusinessAction } from '../business-actions/action.service.js';
import type { BusinessInstructions } from '../context/types.js';
import {
  MAX_POPUP_ACTION_ID_LENGTH,
  MAX_POPUP_BODY_LENGTH,
  MAX_POPUP_TITLE_LENGTH,
  POPUP_TONES,
  POPUP_TYPES,
  type PopupTone,
  type PopupType,
} from '../validation/popupSchema.js';
import type { ConversationStrategy, ConversationStrategyKind } from './conversationStrategy.js';
import type { StrategyKnowledgeResult } from './knowledgeRetrieval.js';
import type { PopupLlmResult } from './popupLlmAdapter.js';

export interface ValidatedPopupLanguage {
  title: string;
  body: string;
  primaryAction?: string;
  secondaryAction?: string;
  tone: PopupTone;
  popupType: PopupType;
}

export type PopupMissingActionReason =
  | 'Business action disabled'
  | 'LLM omitted action'
  | 'Unknown action id'

export interface PopupActionValidationDebug {
  expectedAction: boolean;
  primaryActionReturned: string | null;
  fallbackApplied: boolean;
  fallbackUsed: string | null;
  missingActionReason: PopupMissingActionReason | null;
}

export type PopupResponseRejectReason =
  | 'llm_failed'
  | 'malformed_response'
  | 'schema_violation'
  | 'strategy_mismatch'
  | 'cta_not_allowed'
  | 'missing_business_action'
  | 'business_policy'
  | 'invented_pricing'
  | 'invented_guarantee'
  | 'unsupported_claim';

export interface PopupResponseValidationInput {
  llm: PopupLlmResult;
  strategy: ConversationStrategy;
  knowledge: StrategyKnowledgeResult;
  instructions: BusinessInstructions;
  enabledActions?: BusinessActionConfig[];
}

export type PopupResponseValidationResult =
  | {
      ok: true;
      popup: ValidatedPopupLanguage;
      reasons: [];
      fallback: null;
      actionDebug: PopupActionValidationDebug;
    }
  | {
      ok: false;
      popup: null;
      reasons: PopupResponseRejectReason[];
      fallback: {
        action: 'suppress_popup';
        reason: string;
      };
      rejectedPopup: ValidatedPopupLanguage | null;
      actionDebug: PopupActionValidationDebug;
    };

const EXPECTED_POPUP_TYPE: Record<ConversationStrategyKind, PopupType> = {
  Educate: 'educational',
  Compare: 'comparison',
  ReducePriceAnxiety: 'pricing',
  BuildTrust: 'trust',
  BookDemo: 'booking',
  BookAppointment: 'booking',
  GenerateLead: 'lead',
  Support: 'support',
};

const FALLBACK_ACTIONS_BY_TYPE: Partial<Record<PopupType, readonly string[]>> = {
  comparison: ['pricing', 'learn_more'],
  pricing: ['pricing'],
  booking: ['book_demo', 'contact'],
  lead: ['book_demo', 'contact'],
  support: ['support'],
};

const CTA_INTENT_FALLBACKS: Partial<Record<ConversationStrategy['ctaIntent'], readonly string[]>> = {
  compare_options: ['pricing', 'learn_more'],
  discuss_pricing: ['pricing'],
  capture_lead: ['book_demo', 'contact'],
  book_demo: ['book_demo', 'contact'],
  book_appointment: ['book_demo', 'contact'],
  offer_support: ['support'],
  learn_more: ['learn_more'],
};

const POPUP_TYPES_REQUIRING_ACTION = new Set<PopupType>(['comparison', 'pricing', 'booking', 'lead', 'support']);

const DISCOUNT_PATTERN = /\b(discount|coupon|promo|promotion|special offer|limited[- ]time|deal|save\s+\d+|%\s*off|\d+\s*%\s*off)\b/i;
const PRICE_AMOUNT_PATTERN = /(?:[$?€£]\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:usd|inr|eur|gbp|dollars?|rupees?)\b|\b\d+(?:[.,]\d+)?\s*\/\s*(?:mo|month|year|yr)\b)/i;
const GUARANTEE_PATTERN = /\b(guarantee|guaranteed|money[- ]back|refund|risk[- ]free|no[- ]risk)\b/i;

const CLAIM_PATTERNS: RegExp[] = [
  /\bsoc\s*2\b/i,
  /\bhipaa\b/i,
  /\bgdpr\b/i,
  /\biso\s*\d+/i,
  /\bslack\b/i,
  /\bsalesforce\b/i,
  /\bhubspot\b/i,
  /\bshopify\b/i,
  /\bzapier\b/i,
  /\bwhatsapp\b/i,
  /\bstripe\b/i,
  /\bcalendly\b/i,
  /\bcertified\b/i,
  /\baward[- ]winning\b/i,
  /\b\d+\s*(?:customers|clients|teams|companies)\b/i,
  /\b24\s*\/\s*7\b/i,
  /\bcase stud(?:y|ies)\b/i,
];

const FEATURE_CLAIM_PATTERN =
  /\b(?:includes|offers|supports|provides|has|features|comes with)\s+([a-z0-9][a-z0-9 -]{1,90}?\b(?:integration|integrations|automation|automations|dashboard|dashboards|analytics|reporting|crm|api|apis|feature|features|tool|tools))\b/i;

const REQUIRED_KEYS = ['title', 'body', 'tone', 'popupType'] as const;
const OPTIONAL_KEYS = ['primaryAction', 'secondaryAction'] as const;
const FORBIDDEN_KEYS = ['cta', 'ctaLabel', 'ctaUrl', 'destination', 'showPopup', 'confidence', 'rawEvents', 'events', 'debug', 'reasoning'] as const;

export function validatePopupResponse(input: PopupResponseValidationInput): PopupResponseValidationResult {
  if (!input.llm.ok) return reject(['llm_failed'], null, defaultActionDebug(null, false));

  const parsed = parseRawPopup(input.llm.raw);
  if (!parsed.ok) return reject(parsed.reasons, null, defaultActionDebug(null, false));

  const popup = parsed.popup;
  const reasons: PopupResponseRejectReason[] = [];
  const actionResolution = resolvePopupActions(popup, input.strategy, input.enabledActions ?? []);
  const validatedPopup = actionResolution.popup;

  if (popup.tone !== input.strategy.tone || popup.popupType !== EXPECTED_POPUP_TYPE[input.strategy.kind]) {
    reasons.push('strategy_mismatch');
  }

  if (actionResolution.invalidAction) {
    reasons.push('cta_not_allowed');
    logActionValidationFailure(popup, input.enabledActions ?? [], actionResolution.actionDebug);
  }

  if (!actionResolution.ok) {
    reasons.push('missing_business_action');
    logMissingActionFailure(popup, input.enabledActions ?? [], actionResolution.actionDebug);
  }

  const combined = `${popup.title} ${popup.body}`;
  const knowledgeText = input.knowledge.chunks.map((chunk) => chunk.content).join(' ');

  if (input.instructions.avoidDiscounts && DISCOUNT_PATTERN.test(combined)) {
    reasons.push('business_policy');
  }

  if (PRICE_AMOUNT_PATTERN.test(combined) && !isSupported(combined.match(PRICE_AMOUNT_PATTERN)?.[0] ?? '', knowledgeText)) {
    reasons.push('invented_pricing');
  }

  if (GUARANTEE_PATTERN.test(combined) && !containsAnySupportedClaim(combined, knowledgeText, GUARANTEE_PATTERN)) {
    reasons.push('invented_guarantee');
  }

  if (hasUnsupportedSpecificClaim(combined, knowledgeText)) {
    reasons.push('unsupported_claim');
  }

  if (hasUnsupportedFeatureClaim(combined, knowledgeText)) {
    reasons.push('unsupported_claim');
  }

  return reasons.length > 0
    ? reject(unique(reasons), popup, actionResolution.actionDebug)
    : { ok: true, popup: validatedPopup, reasons: [], fallback: null, actionDebug: actionResolution.actionDebug };
}

function resolvePopupActions(
  popup: ValidatedPopupLanguage,
  strategy: ConversationStrategy,
  enabledActions: BusinessActionConfig[],
): { ok: boolean; popup: ValidatedPopupLanguage; invalidAction: boolean; actionDebug: PopupActionValidationDebug } {
  const expectedAction = POPUP_TYPES_REQUIRING_ACTION.has(popup.popupType);
  const primaryActionReturned = popup.primaryAction ?? null;
  const primary = findBusinessAction(enabledActions, popup.primaryAction);
  const secondary = findBusinessAction(enabledActions, popup.secondaryAction);
  const invalidAction = Boolean((popup.primaryAction && !primary) || (popup.secondaryAction && !secondary));

  if (primary) {
    return {
      ok: true,
      popup: {
        ...popup,
        primaryAction: primary.actionId,
        ...(secondary ? { secondaryAction: secondary.actionId } : {}),
      },
      invalidAction,
      actionDebug: {
        expectedAction,
        primaryActionReturned,
        fallbackApplied: false,
        fallbackUsed: null,
        missingActionReason: null,
      },
    };
  }

  const fallback = expectedAction ? findFallbackAction(enabledActions, popup.popupType, strategy.ctaIntent) : null;
  if (fallback) {
    return {
      ok: true,
      popup: { ...popup, primaryAction: fallback.actionId, ...(secondary ? { secondaryAction: secondary.actionId } : {}) },
      invalidAction,
      actionDebug: {
        expectedAction,
        primaryActionReturned,
        fallbackApplied: true,
        fallbackUsed: fallback.actionId,
        missingActionReason: primaryActionReturned ? null : 'LLM omitted action',
      },
    };
  }

  const missingActionReason: PopupMissingActionReason | null = !expectedAction
    ? null
    : primaryActionReturned
      ? invalidActionReason(primaryActionReturned, enabledActions)
      : 'LLM omitted action';

  return {
    ok: !expectedAction,
    popup: { ...popup, ...(secondary ? { secondaryAction: secondary.actionId } : {}) },
    invalidAction,
    actionDebug: {
      expectedAction,
      primaryActionReturned,
      fallbackApplied: false,
      fallbackUsed: null,
      missingActionReason,
    },
  };
}

function findFallbackAction(
  enabledActions: BusinessActionConfig[],
  popupType: PopupType,
  ctaIntent: ConversationStrategy['ctaIntent'],
): BusinessActionConfig | null {
  for (const actionId of fallbackCandidates(popupType, ctaIntent)) {
    const action = findBusinessAction(enabledActions, actionId);
    if (action) return action;
  }
  return null;
}

function fallbackCandidates(popupType: PopupType, ctaIntent: ConversationStrategy['ctaIntent']): readonly string[] {
  return [...(CTA_INTENT_FALLBACKS[ctaIntent] ?? []), ...(FALLBACK_ACTIONS_BY_TYPE[popupType] ?? [])].filter((actionId, index, list) => list.indexOf(actionId) === index);
}

function invalidActionReason(actionId: string, enabledActions: BusinessActionConfig[]): PopupMissingActionReason {
  return enabledActions.some((action) => action.actionId === actionId && !action.enabled) ? 'Business action disabled' : 'Unknown action id';
}

function defaultActionDebug(primaryActionReturned: string | null, expectedAction: boolean): PopupActionValidationDebug {
  return {
    expectedAction,
    primaryActionReturned,
    fallbackApplied: false,
    fallbackUsed: null,
    missingActionReason: null,
  };
}

function parseRawPopup(raw: unknown): { ok: true; popup: ValidatedPopupLanguage } | { ok: false; reasons: PopupResponseRejectReason[] } {
  if (!isPlainObject(raw)) return { ok: false, reasons: ['malformed_response'] };

  const keys = Object.keys(raw);
  if (FORBIDDEN_KEYS.some((key) => keys.includes(key))) return { ok: false, reasons: ['schema_violation'] };
  if (!REQUIRED_KEYS.every((key) => keys.includes(key))) return { ok: false, reasons: ['schema_violation'] };
  const allowedKeys = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];
  if (keys.some((key) => !allowedKeys.includes(key as (typeof allowedKeys)[number]))) {
    return { ok: false, reasons: ['schema_violation'] };
  }

  const title = sanitizeString(raw.title);
  const body = sanitizeString(raw.body);
  const tone = raw.tone;
  const popupType = raw.popupType;
  const primaryAction = sanitizeActionId(raw.primaryAction);
  const secondaryAction = sanitizeActionId(raw.secondaryAction);

  if (
    !title ||
    !body ||
    title.length > MAX_POPUP_TITLE_LENGTH ||
    body.length > MAX_POPUP_BODY_LENGTH ||
    typeof tone !== 'string' ||
    typeof popupType !== 'string' ||
    !POPUP_TONES.includes(tone as PopupTone) ||
    !POPUP_TYPES.includes(popupType as PopupType) ||
    primaryAction === false ||
    secondaryAction === false
  ) {
    return { ok: false, reasons: ['schema_violation'] };
  }

  return {
    ok: true,
    popup: {
      title,
      body,
      ...(primaryAction ? { primaryAction } : {}),
      ...(secondaryAction ? { secondaryAction } : {}),
      tone: tone as PopupTone,
      popupType: popupType as PopupType,
    },
  };
}

function sanitizeString(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeActionId(value: unknown): string | null | false {
  if (value === undefined || value === null || value === '') return null;
  const clean = sanitizeString(value);
  if (clean.length > MAX_POPUP_ACTION_ID_LENGTH) return false;
  return /^[a-z][a-z0-9_]{1,63}$/.test(clean) ? clean : false;
}

function logActionValidationFailure(popup: ValidatedPopupLanguage, enabledActions: BusinessActionConfig[], actionDebug: PopupActionValidationDebug): void {
  console.warn('[popup-validation] cta_not_allowed', JSON.stringify({
    generatedPopupTitle: popup.title,
    generatedPrimaryAction: popup.primaryAction ?? null,
    generatedSecondaryAction: popup.secondaryAction ?? null,
    allowedActionIds: enabledActions.map((action) => action.actionId),
    exactValidatorBranch: 'validatePopupResponse -> resolvePopupActions',
    popupType: popup.popupType,
    actionDebug,
  }));
}

function logMissingActionFailure(popup: ValidatedPopupLanguage, enabledActions: BusinessActionConfig[], actionDebug: PopupActionValidationDebug): void {
  console.warn('[popup-validation] missing_business_action', JSON.stringify({
    generatedPopupTitle: popup.title,
    generatedPrimaryAction: popup.primaryAction ?? null,
    generatedSecondaryAction: popup.secondaryAction ?? null,
    allowedActionIds: enabledActions.map((action) => action.actionId),
    exactValidatorBranch: 'validatePopupResponse -> resolvePopupActions',
    popupType: popup.popupType,
    actionDebug,
  }));
}

function hasUnsupportedSpecificClaim(text: string, knowledgeText: string): boolean {
  return CLAIM_PATTERNS.some((pattern) => {
    const match = text.match(pattern)?.[0];
    return match ? !isSupported(match, knowledgeText) : false;
  });
}

function hasUnsupportedFeatureClaim(text: string, knowledgeText: string): boolean {
  const match = text.match(FEATURE_CLAIM_PATTERN)?.[0];
  return match ? !isSupported(match, knowledgeText) : false;
}

function containsAnySupportedClaim(text: string, knowledgeText: string, pattern: RegExp): boolean {
  const match = text.match(pattern)?.[0];
  return match ? isSupported(match, knowledgeText) : false;
}

function isSupported(claim: string, knowledgeText: string): boolean {
  const normalizedClaim = normalize(claim);
  if (!normalizedClaim) return false;
  return normalize(knowledgeText).includes(normalizedClaim);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function reject(
  reasons: PopupResponseRejectReason[],
  rejectedPopup: ValidatedPopupLanguage | null = null,
  actionDebug: PopupActionValidationDebug,
): PopupResponseValidationResult {
  const safeReasons = unique(reasons);
  return {
    ok: false,
    popup: null,
    reasons: safeReasons,
    fallback: {
      action: 'suppress_popup',
      reason: safeReasons.join(','),
    },
    rejectedPopup,
    actionDebug,
  };
}


