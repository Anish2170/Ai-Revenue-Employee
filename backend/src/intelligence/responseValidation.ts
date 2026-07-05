/**
 * Response Validation (Sprint 4.2 component 6).
 *
 * Validates raw popup language from the LLM adapter before any visitor-facing
 * rendering can exist. This layer does not generate a popup and does not decide
 * whether to interrupt; it only turns untrusted model output into either a
 * trusted language object or a fail-closed fallback.
 */
import type { BusinessInstructions } from '../context/types.js';
import {
  MAX_POPUP_BODY_LENGTH,
  MAX_POPUP_CTA_LENGTH,
  MAX_POPUP_TITLE_LENGTH,
  POPUP_TONES,
  POPUP_TYPES,
  type PopupTone,
  type PopupType,
} from '../validation/popupSchema.js';
import type { ConversationStrategy, ConversationStrategyKind, StrategyCtaIntent } from './conversationStrategy.js';
import type { StrategyKnowledgeResult } from './knowledgeRetrieval.js';
import type { PopupLlmResult } from './popupLlmAdapter.js';

export interface ValidatedPopupLanguage {
  title: string;
  body: string;
  cta: string;
  tone: PopupTone;
  popupType: PopupType;
}

export type PopupResponseRejectReason =
  | 'llm_failed'
  | 'malformed_response'
  | 'schema_violation'
  | 'strategy_mismatch'
  | 'cta_not_allowed'
  | 'business_policy'
  | 'invented_pricing'
  | 'invented_guarantee'
  | 'unsupported_claim';

export interface PopupResponseValidationInput {
  llm: PopupLlmResult;
  strategy: ConversationStrategy;
  knowledge: StrategyKnowledgeResult;
  instructions: BusinessInstructions;
}

export type PopupResponseValidationResult =
  | {
      ok: true;
      popup: ValidatedPopupLanguage;
      reasons: [];
      fallback: null;
    }
  | {
      ok: false;
      popup: null;
      reasons: PopupResponseRejectReason[];
      fallback: {
        action: 'suppress_popup';
        reason: string;
      };
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

const CTA_PATTERNS: Record<StrategyCtaIntent, RegExp[]> = {
  learn_more: [/\blearn\b/i, /\bexplore\b/i, /\bsee\b/i, /\bdetails?\b/i],
  compare_options: [/\bcompare\b/i, /\boptions?\b/i, /\bplans?\b/i],
  discuss_pricing: [/\bpricing\b/i, /\bprice\b/i, /\bcost\b/i, /\bplans?\b/i, /\btalk\b/i, /\bdiscuss\b/i],
  book_demo: [/\bbook\b/i, /\bschedule\b/i, /\bdemo\b/i],
  book_appointment: [/\bbook\b/i, /\bschedule\b/i, /\bappointment\b/i, /\bvisit\b/i],
  capture_lead: [/\bcontact\b/i, /\bget in touch\b/i, /\btalk\b/i, /\bstart\b/i],
  offer_support: [/\bhelp\b/i, /\bsupport\b/i, /\bquestion\b/i],
};

const DISCOUNT_PATTERN = /\b(discount|coupon|promo|promotion|special offer|limited[- ]time|deal|save\s+\d+|%\s*off|\d+\s*%\s*off)\b/i;
const PRICE_AMOUNT_PATTERN = /(?:[$₹€£]\s*\d+(?:[.,]\d+)?|\b\d+(?:[.,]\d+)?\s*(?:usd|inr|eur|gbp|dollars?|rupees?)\b|\b\d+(?:[.,]\d+)?\s*\/\s*(?:mo|month|year|yr)\b)/i;
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

const REQUIRED_KEYS = ['title', 'body', 'cta', 'tone', 'popupType'] as const;
const FORBIDDEN_KEYS = ['showPopup', 'confidence', 'rawEvents', 'events', 'debug', 'reasoning'] as const;

export function validatePopupResponse(input: PopupResponseValidationInput): PopupResponseValidationResult {
  if (!input.llm.ok) return reject(['llm_failed']);

  const parsed = parseRawPopup(input.llm.raw);
  if (!parsed.ok) return reject(parsed.reasons);

  const popup = parsed.popup;
  const reasons: PopupResponseRejectReason[] = [];

  if (popup.tone !== input.strategy.tone || popup.popupType !== EXPECTED_POPUP_TYPE[input.strategy.kind]) {
    reasons.push('strategy_mismatch');
  }

  if (!ctaMatchesIntent(popup.cta, input.strategy.ctaIntent)) {
    reasons.push('cta_not_allowed');
  }

  const combined = `${popup.title} ${popup.body} ${popup.cta}`;
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

  return reasons.length > 0 ? reject(unique(reasons)) : { ok: true, popup, reasons: [], fallback: null };
}

function parseRawPopup(raw: unknown): { ok: true; popup: ValidatedPopupLanguage } | { ok: false; reasons: PopupResponseRejectReason[] } {
  if (!isPlainObject(raw)) return { ok: false, reasons: ['malformed_response'] };

  const keys = Object.keys(raw);
  if (FORBIDDEN_KEYS.some((key) => keys.includes(key))) return { ok: false, reasons: ['schema_violation'] };
  if (!REQUIRED_KEYS.every((key) => keys.includes(key))) return { ok: false, reasons: ['schema_violation'] };
  if (keys.some((key) => !REQUIRED_KEYS.includes(key as (typeof REQUIRED_KEYS)[number]))) {
    return { ok: false, reasons: ['schema_violation'] };
  }

  const title = sanitizeString(raw.title);
  const body = sanitizeString(raw.body);
  const cta = sanitizeString(raw.cta);
  const tone = raw.tone;
  const popupType = raw.popupType;

  if (
    !title ||
    !body ||
    !cta ||
    title.length > MAX_POPUP_TITLE_LENGTH ||
    body.length > MAX_POPUP_BODY_LENGTH ||
    cta.length > MAX_POPUP_CTA_LENGTH ||
    typeof tone !== 'string' ||
    typeof popupType !== 'string' ||
    !POPUP_TONES.includes(tone as PopupTone) ||
    !POPUP_TYPES.includes(popupType as PopupType)
  ) {
    return { ok: false, reasons: ['schema_violation'] };
  }

  return {
    ok: true,
    popup: {
      title,
      body,
      cta,
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

function ctaMatchesIntent(cta: string, intent: StrategyCtaIntent): boolean {
  return CTA_PATTERNS[intent].some((pattern) => pattern.test(cta));
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

function reject(reasons: PopupResponseRejectReason[]): PopupResponseValidationResult {
  const safeReasons = unique(reasons);
  return {
    ok: false,
    popup: null,
    reasons: safeReasons,
    fallback: {
      action: 'suppress_popup',
      reason: safeReasons.join(','),
    },
  };
}
