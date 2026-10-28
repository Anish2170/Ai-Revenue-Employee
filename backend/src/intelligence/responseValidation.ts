/**
 * Response Validation (Sprint 4.2 component 6).
 *
 * Validates raw popup language from the LLM adapter before any visitor-facing
 * rendering can exist. Business action destinations are never accepted from the
 * model; optional action IDs must match the enabled business configuration.
 */
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import { buildPopupCopyPlan, checkPopupGrounding, type PopupEvidence, type PopupGroundingContext } from './popupGrounding.js';
import { popupCompatibleActions, resolvePopupAction, type PopupActionContext } from './popupActionPolicy.js';
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
  | 'Action incompatible with popup'

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
  websiteId?: string;
  groundingContext?: PopupGroundingContext;
}

export type PopupResponseValidationResult =
  | {
      ok: true;
      popup: ValidatedPopupLanguage;
      evidence: PopupEvidence[];
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

const POPUP_TYPES_REQUIRING_ACTION = new Set<PopupType>(['comparison', 'pricing', 'booking', 'lead', 'support']);
const DISCOUNT_PATTERN = /\b(discount|coupon|promo|promotion|special offer|limited[- ]time|deal|save\s+\d+|\d+\s*%\s*off)\b/i;
// Diagnostic patterns never establish factual support.
const PRICE_AMOUNT_PATTERN = /[$€£₹¥]|\b(?:USD|EUR|GBP|INR|CAD|AUD|price|costs?|fees?|savings?|discount)\b|\d+\s*%/i;
const GUARANTEE_PATTERN = /\b(guarantee|guaranteed|money[- ]back|refund|risk[- ]free|no[- ]risk)\b/i;

const REQUIRED_KEYS = ['title', 'body', 'tone', 'popupType'] as const;
const OPTIONAL_KEYS = ['primaryAction', 'secondaryAction'] as const;
const FORBIDDEN_KEYS = ['cta', 'ctaLabel', 'ctaUrl', 'destination', 'showPopup', 'confidence', 'rawEvents', 'events', 'debug', 'reasoning'] as const;

export function validatePopupResponse(input: PopupResponseValidationInput): PopupResponseValidationResult {
  if (!input.llm.ok) return reject(['llm_failed'], null, defaultActionDebug(null, false));

  const parsed = parseRawPopup(input.llm.raw);
  if (!parsed.ok) return reject(parsed.reasons, null, defaultActionDebug(null, false));

  const grounding = checkPopupGrounding(parsed.popup.title, parsed.popup.body, buildPopupCopyPlan(input.knowledge, input.instructions, input.groundingContext));
  const popup = { ...parsed.popup, body: grounding.body };
  if (grounding.ok && popup.body.length > MAX_POPUP_BODY_LENGTH) return reject(['schema_violation'], popup, defaultActionDebug(popup.primaryAction ?? null, false));
  const reasons: PopupResponseRejectReason[] = [];
  const actionResolution = resolvePopupActions(popup, input.strategy, input.enabledActions ?? [], input.instructions, { websiteId: input.websiteId, websiteUrl: input.instructions.websiteUrl, businessName: input.instructions.businessName });
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

  if (input.instructions.avoidDiscounts && DISCOUNT_PATTERN.test(combined)) {
    reasons.push('business_policy');
  }

  if (!grounding.ok) {
    reasons.push('unsupported_claim');
    if (PRICE_AMOUNT_PATTERN.test(combined)) reasons.push('invented_pricing');
    if (GUARANTEE_PATTERN.test(combined)) reasons.push('invented_guarantee');
  }

  return reasons.length > 0
    ? reject(unique(reasons), popup, actionResolution.actionDebug)
    : { ok: true, popup: validatedPopup, evidence: grounding.evidence, reasons: [], fallback: null, actionDebug: actionResolution.actionDebug };
}

function resolvePopupActions(
  popup: ValidatedPopupLanguage,
  strategy: ConversationStrategy,
  enabledActions: BusinessActionConfig[],
  instructions: BusinessInstructions,
  context: PopupActionContext,
): { ok: boolean; popup: ValidatedPopupLanguage; invalidAction: boolean; actionDebug: PopupActionValidationDebug } {
  const expectedAction = POPUP_TYPES_REQUIRING_ACTION.has(popup.popupType);
  const primaryActionReturned = popup.primaryAction ?? null;
  const primary = resolvePopupAction(enabledActions, popup.primaryAction, strategy, instructions, false, `${popup.title} ${popup.body}`, context);
  const secondary = resolvePopupAction(enabledActions, popup.secondaryAction, strategy, instructions, true, `${popup.title} ${popup.body}`, context);
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

  const fallback = expectedAction && !popup.primaryAction ? popupCompatibleActions(enabledActions, strategy, instructions, false, `${popup.title} ${popup.body}`, context)[0] : null;
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

function invalidActionReason(actionId: string, enabledActions: BusinessActionConfig[]): PopupMissingActionReason {
  const action = enabledActions.find(item => item.actionId === actionId);
  return !action ? 'Unknown action id' : !action.enabled ? 'Business action disabled' : 'Action incompatible with popup';
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


