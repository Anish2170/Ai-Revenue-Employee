import type { BusinessActionConfig } from '../business-actions/action.types.js';
import type { BusinessInstructions } from '../context/types.js';
import type { ConversationStrategy } from './conversationStrategy.js';
import { creativeActionLabel } from './creativePopupCopy.js';

export interface PopupActionContext { websiteId?: string; websiteUrl?: string; businessName?: string }
export type PopupActionStrategy = Pick<ConversationStrategy, 'kind' | 'business'>;
export type PopupActionPurpose = 'pricing' | 'support' | 'appointment' | 'demo' | 'product' | 'learn' | 'contact';
const ALLOWED: Record<ConversationStrategy['kind'], readonly PopupActionPurpose[]> = {
  ReducePriceAnxiety: ['pricing'], Compare: ['pricing', 'product', 'learn'], Educate: ['learn', 'product'], BuildTrust: ['learn'],
  BookAppointment: ['appointment'], BookDemo: ['demo'], GenerateLead: ['contact', 'appointment', 'demo', 'product'], Support: ['support'],
};
const ALIASES: Record<string, string[]> = { support: ['contact_support'], contact_support: ['support'], contact: ['contact_sales'], contact_sales: ['contact'], learn_more: ['documentation'], documentation: ['learn_more'] };
// CTA labels are visitor-visible copy too. Unknown promotional labels cannot
// introduce a factual promise through an otherwise approved action ID.
const SAFE_LABEL = /^(?:(?:view|see|check|compare|explore|browse|shop) (?:our |the )?(?:pricing|prices|plans|fees|collection|products|catalog|catalogue|services)|(?:book|schedule|request|arrange) (?:a |an )?(?:appointment|consultation|demo|site visit)|(?:contact|talk to) (?:us|sales|support|our team)|(?:get )?support|learn more|read more|documentation|(?:get )?help|buy now|shop now|get in touch|pricing|contact|appointment|book demo|call now|call us|email us|whatsapp)$/i;

function purpose(text: string): PopupActionPurpose | null {
  const words = text.toLowerCase().replace(/[_/-]+/g, ' ');
  if (/\b(appointments?|consultations?|site visit|reservations?|reserve|booking|stay|rooms?|table)\b/.test(words)) return 'appointment';
  if (/\b(demo|demonstration)\b/.test(words)) return 'demo';
  if (/\b(pricing|prices?|plans?|fees|costs?)\b/.test(words)) return 'pricing';
  if (/\b(collection|products?|shop|catalog|catalogue|buy|purchase)\b/.test(words)) return 'product';
  if (/\b(learn|documentation|docs|explore|read more|information|services|about)\b/.test(words)) return 'learn';
  if (/\b(support|help|assistance)\b/.test(words)) return 'support';
  if (/\b(contact|sales|call|email|whatsapp)\b/.test(words)) return 'contact';
  return null;
}

// This guard rejects material label claims; it does not turn a label into
// evidence or infer purpose from arbitrary multilingual marketing wording.
const MATERIAL_LABEL = /[$€£₹¥%\p{N}]|\b(free|discount|guarantee(?:d)?|refund|trial|unlimited|instant|delivery|available|tomorrow|today|gratuit(?:e)?|garanti|offert|muft|pakka|guaranteed)\b|मुफ्त|गारंटी|निःशुल्क/iu;
function configuredPurpose(id: string): PopupActionPurpose | null {
  if (/^(?:pricing|prices|view_pricing|view_plans|compare_plans)(?:_|$)/.test(id)) return 'pricing';
  if (/^(?:book|schedule|request|reserve)_(?:appointment|consultation|table|stay|site_visit)(?:_|$)/.test(id)) return 'appointment';
  if (/^(?:book|request|view)_demo(?:_|$)/.test(id)) return 'demo';
  if (/^(?:view|discover)_collection(?:_|$)|^(?:products|collection|shop|buy)(?:_|$)/.test(id)) return 'product';
  if (/^(?:support|contact_support|help)(?:_|$)/.test(id)) return 'support';
  if (/^(?:contact|call|email|whatsapp)(?:_|$)/.test(id)) return 'contact';
  if (/^(?:learn_more|documentation|docs|case_studies)(?:_|$)/.test(id)) return 'learn';
  return null;
}
export function actionPurpose(action: BusinessActionConfig, context: PopupActionContext = {}): PopupActionPurpose | null {
  if (!action.enabled || !safeDestination(action) || !action.label.trim() || action.label.length > 80 || /[<>\u0000-\u001f]/u.test(action.label)) return null;
  const authority = action.authority;
  const trusted = Boolean(authority && context.websiteId && ['owner', 'discovered'].includes(authority.source) && authority.websiteId === context.websiteId && authority.actionId === action.actionId && authority.label === action.label && authority.destinationType === action.destinationType && authority.destination === action.destination);
  if (authority && !trusted) return null;
  if (MATERIAL_LABEL.test(action.label.normalize('NFKC'))) return null;
  if (trusted && authority?.source === 'owner' && !SAFE_LABEL.test(action.label.trim()) && !creativeActionLabel(action.label, context.businessName)) return null;
  const id = trusted ? configuredPurpose(action.actionId) : purpose(action.actionId);
  let destination: PopupActionPurpose | null = null;
  if (action.destinationType === 'URL') {
    try {
      const url = new URL(action.destination);
      // Recognizable redirect targets cannot hide behind an innocent path.
      if ([...url.searchParams.keys()].some(key => /^(url|redirect|redirect_uri|next|return|returnto|target)$/i.test(key))) return null;
      destination = purpose(decodeURIComponent(url.pathname + ' ' + url.hash));
      const segments = decodeURIComponent(url.pathname + ' ' + url.hash).replace(/[_-]/g, ' ').split(/[ /#]+/);
      const concrete = new Set(segments.map(purpose).filter(value => value && !['learn', 'contact'].includes(value)));
      if (concrete.size > 1) return null;
      if (concrete.size === 1) destination = [...concrete][0]!;
      if (authority?.source === 'discovered' && (!context.websiteUrl || new URL(context.websiteUrl).origin !== url.origin)) return null;
    } catch { return null; }
  }
  if (authority?.source === 'discovered' && ((authority.confidence ?? 0) < 0.85 || !destination || !id)) return null;
  // Discovery confidence is classification evidence, not owner approval of new
  // marketing claims/translated labels. A manual action can approve presentation.
  if (authority?.source === 'discovered' && !SAFE_LABEL.test(action.label.trim())) return null;
  if (!trusted) {
    // Backward-compatible legacy records retain their previous narrow policy.
    if (!SAFE_LABEL.test(action.label.trim())) return null;
    const label = purpose(action.label);
    const legacyAppointment = id === 'demo' && label === 'appointment';
    if (id && label && id !== label && !legacyAppointment && !(id === 'learn' && label === 'product')) return null;
    const resolved = label ?? id;
    return resolved && destinationAgrees(resolved, destination) ? resolved : null;
  }
  // Stable configured IDs are the semantic channel. A known destination can
  // resolve an opaque owner ID; discovered opaque/ambiguous targets fail closed.
  const resolved = id === 'demo' && destination === 'appointment' ? 'appointment' : id ?? destination;
  if (!resolved || !destinationAgrees(resolved, destination)) return null;
  // Obvious standard-label disagreement is still useful negative evidence.
  const standardLabel = SAFE_LABEL.test(action.label.trim()) ? purpose(action.label) : null;
  if (standardLabel && standardLabel !== resolved && !(resolved === 'product' && standardLabel === 'learn')) return null;
  return resolved;
}
export function publicPopupAction(action: BusinessActionConfig): BusinessActionConfig {
  const { authority: _authority, ...presentation } = action;
  return presentation;
}
function destinationAgrees(resolved: PopupActionPurpose, destination: PopupActionPurpose | null): boolean {
  return !destination || destination === resolved || (resolved === 'learn' && destination === 'product') || (resolved === 'appointment' && destination === 'contact');
}

function safeDestination(action: BusinessActionConfig): boolean {
  const value = action.destination.trim();
  if (action.destinationType === 'CHAT') return value === '' || value === 'chat';
  if (action.destinationType === 'PHONE') return /^(?:tel:)?\+?[0-9][0-9\-()\s]{5,30}$/.test(value);
  if (action.destinationType === 'EMAIL') return /^(?:mailto:)?[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)|[:]|\.local$/i.test(url.hostname)) return false;
    if (action.destinationType === 'WHATSAPP') return /(^|\.)(wa\.me|whatsapp\.com)$/i.test(url.hostname);
    return action.destinationType === 'URL';
  } catch { return false; }
}

function compatible(action: BusinessActionConfig, strategy: PopupActionStrategy, instructions: BusinessInstructions, secondary: boolean, body?: string, context: PopupActionContext = {}): boolean {
  let resolved: PopupActionPurpose | null;
  try { resolved = actionPurpose(action, context); } catch { return false; }
  if (!resolved) return false;
  const allowed = [...ALLOWED[strategy.kind], ...(secondary && ['ReducePriceAnxiety','BookAppointment','BookDemo','GenerateLead'].includes(strategy.kind) ? ['learn' as const] : [])];
  if (!allowed.includes(resolved)) return false;
  const goal = purpose(instructions.goal ?? strategy.business.objectiveKey);
  if (strategy.business.isSupport && resolved !== 'support') return false;
  if (['BookAppointment','BookDemo','GenerateLead'].includes(strategy.kind) && goal && ['appointment','demo','product','support'].includes(goal) && resolved !== goal && !(secondary && resolved === 'learn')) return false;
  const message = body ? purpose(body) : null;
  if (message && ['appointment','demo','product','pricing'].includes(message) && message !== resolved && !(secondary && resolved === 'learn')) return false;
  return true;
}

export function popupCompatibleActions(actions: BusinessActionConfig[], strategy: PopupActionStrategy, instructions: BusinessInstructions, secondary = false, body?: string, context: PopupActionContext = {}): BusinessActionConfig[] {
  return actions.filter(action => actions.filter(other => other.actionId === action.actionId).length === 1 && compatible(action, strategy, instructions, secondary, body, context));
}

export function resolvePopupAction(actions: BusinessActionConfig[], id: string | undefined, strategy: PopupActionStrategy, instructions: BusinessInstructions, secondary: boolean, body: string, context: PopupActionContext = {}): BusinessActionConfig | null {
  if (!id) return null;
  const direct = actions.filter(action => action.actionId === id);
  if (direct.length) return direct.length === 1 && compatible(direct[0], strategy, instructions, secondary, body, context) ? direct[0] : null;
  const compatibleActions = popupCompatibleActions(actions, strategy, instructions, secondary, body, context);
  return compatibleActions.find(action => (ALIASES[id] ?? []).includes(action.actionId)) ?? null;
}
