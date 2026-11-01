/** Consumer-side answer contracts, not a knowledge ingestion/freshness system.
 * Material claims require typed source evidence; connected capabilities are
 * separate from website prose. Unsafe drafts never become partial UI output. */
import type { ResolvedContext, RetrievedChunk } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import { actionPurpose } from '../intelligence/popupActionPolicy.js';
import type { ChatLanguageState } from './chatLanguage.js';
import { parseAndValidateUrl, isPublicAddress } from '../security/ssrf.js';
import { isIP } from 'node:net';
import { safetyLanguageCopy } from './chatSafetyLanguage.js';
import { priceRecords, matchesSubject, subjectTerms, broadCatalogQuery } from '../context/sourceRecords.js';

export type AnswerState = 'known_positive' | 'known_negative' | 'unknown' | 'contradictory' | 'ambiguous';
type Kind = 'price' | 'refund' | 'cancellation' | 'hours' | 'closed' | 'service' | 'booking' | 'contact';
export interface ChatFact { kind: Kind; subject: string; value: string; text: string; chunk: RetrievedChunk; negative: boolean; amount?: string; suffix?: string; from?: boolean; entity?: string }
export interface ChatSafetyPlan {
  state: AnswerState; query: string; topic: string; kind: string; language: ChatLanguageState; businessName: string;
  facts: ChatFact[]; selected: ChatFact[]; excerpts: RetrievedChunk[];
  booking: BusinessActionConfig[]; contact: BusinessActionConfig[];
  navigation: { pricing: BusinessActionConfig[]; services: BusinessActionConfig[] };
  leadCapture: boolean; leadOffer: boolean; contactSubmission: boolean;
  evidenceStatus?: 'answer_available' | 'answer_unavailable' | 'parser_miss' | 'safety_rejected';
}
const MONEY = String.raw`(?:[$₹€£¥]\s*\d[\d,.]*|(?:USD|INR|EUR|GBP|CAD|AUD)\s*\d[\d,.]*)`;
const PRICE = new RegExp(String.raw`^(.{1,80}?) (starts? at|costs?|is priced at) (${MONEY})((?:(?:\s*\/(?:mo|month|yr|year))|(?:\s+(?:per|a) (?:month|year|visit|session|item))|(?:,?\s+(?:billed (?:annually|monthly)|(?:including|excluding) (?:tax|VAT)|for (?:new|existing) customers)))*)\.$`, 'iu');
const UNSAFE_SOURCE = /ignore|system prompt|instruction|pretend|hypothetical|for example|used to|previously|expired|outdated|historical|<script|override/iu;
export function normalized(text: string): string { return text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim(); }
function semantics(text: string): string {
  return normalized(text)
    .replace(/दांतों? की सफाई|दाँतों? की सफाई|daant(?:on)? ki safa[iy]i|daant ki safai|teeth cleaning/gu, 'dental cleaning')
    .replace(/रूट कैनाल(?: उपचार)?/gu, 'root canal treatment')
    .replace(/घर पर इलाज|घर पर उपचार|home (?:care|visits?|treatment)|ghar par (?:ilaaj|ilaj|treatment)/gu, 'home treatment')
    .replace(/दंत प्रत्यारोपण|डेंटल इम्प्लांट|dental implants?/gu, 'dental implant')
    .replace(/आपातकालीन दंत चिकित्सा|आपातकालीन इलाज|emergency (?:dental )?(?:care|treatment)/gu, 'emergency dental treatment')
    .replace(/निःशुल्क|मुफ्त|muft|no.cost/gu, 'free')
    .replace(/परामर्श|consulteshan|consultation/gu, 'consultation')
    .replace(/रविवार|ravivaar|ravivar/gu, 'sunday')
    .replace(/अपॉइंटमेंट|appointment|apoyntment/gu, 'appointment');
}
function terms(text: string): string[] {
  const stop = new Set('do does you your we our the a an is are for at of this clinic business offer offered provide provided available service services what which can could would please tell me about it i want need how price pricing cost costs fee fees starting starts from ka ki ke kya hai hain ho hota hoti kitna kitne aap aapki mein ko karne rule se shuru hota he rehta की का के क्या है हैं कितना कीमत रुपये कितने शुरू होती'.split(' '));
  return (semantics(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter(word => !stop.has(word));
}
function sameSubject(left: string, right: string): boolean {
  const a = terms(left), b = terms(right);
  return a.length > 0 && b.length > 0 && a.every(word => b.includes(word)) && b.every(word => a.includes(word));
}
function parseFact(text: string, chunk: RetrievedChunk): ChatFact | null {
  const make = (kind: Kind, subject: string, value: string, negative = false, extra = {}) => ({ kind, subject, value, text, chunk, negative, ...extra });
  const price = text.match(PRICE);
  if (price) return make('price', price[1], `${price[3]}${price[4]}:${/start/i.test(price[2])}`, false, { amount: price[3], suffix: price[4], from: /start/i.test(price[2]) });
  const refund = text.match(/^(?:(.+? fees?) (?:are|is) (non-refundable|not refundable|refundable)|(Refunds?|Returns?|Cancellations?) (?:are|is) (not available|unavailable|available|not accepted|accepted|not offered|offered)(.*))\.$/iu);
  if (refund) {
    const subject = refund[1] ?? refund[3], status = refund[2] ?? refund[4], suffix = refund[5] ?? '';
    if (suffix && !/^ within \d+ days(?: for unopened (?:items|products))?$/i.test(suffix)) return null;
    return make('refund', subject, `${/non-|not |unavailable/i.test(status) ? 'no' : 'yes'}${suffix}`, /non-|not |unavailable/i.test(status));
  }
  const notice = text.match(/^Appointment cancellations require (\d+) hours['’] notice\.$/iu);
  if (notice) return make('cancellation', 'appointment cancellation', notice[1]);
  const hours = text.match(/^(?:The clinic|We|The business) (?:opens?|is open|are open) (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (?:to|through) (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),? (\d{1,2}(?::\d{2})?\s*[AP]M) to (\d{1,2}(?::\d{2})?\s*[AP]M)\.$/iu);
  if (hours) return make('hours', 'opening hours', hours.slice(1).join('|'), false, { entity: /^The clinic/i.test(text) ? 'clinic' : 'business' });
  const closed = text.match(/^(?:The clinic|We|The business) (?:is|are) closed on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\.$/iu);
  if (closed) return make('closed', 'opening hours', closed[1], true, { entity: /^The clinic/i.test(text) ? 'clinic' : 'business' });
  const service = text.match(/^(.+?) (?:is|are) (not offered|not provided|not available|offered|provided|available)\.$/iu)
    ?? text.match(/^(?:We|The clinic) (do not offer|do not provide|offer|provide) (.+?)\.$/iu)?.map((part, index, match) => index === 1 ? match[2] : index === 2 ? (/not/i.test(match[1]) ? 'not offered' : 'offered') : part);
  if (service && !/refund|return|cancellations?|appointments? slots?|times?|guarantee|discount|free|guide|checklist|email|delivery|instant/i.test(service[1])) return make(/online booking/i.test(service[1]) ? 'booking' : 'service', service[1], /not /i.test(service[2]) ? 'no' : 'yes', /not /i.test(service[2]));
  const free = text.match(/^(?:A |The )?(free consultation|consultation) (?:is|are) (free|not free|not offered|offered|available)\.$/iu);
  if (free && (/^free /i.test(free[1]) || /^(?:not )?free$/i.test(free[2]))) return make('service', 'free consultation', /not/i.test(free[2]) ? 'no' : 'yes', /not/i.test(free[2]));
  return null;
}
export function safeChatSourceUrl(raw: string, websiteUrl?: string): string | null {
  try { const url = parseAndValidateUrl(new URL(raw, websiteUrl || undefined).href); const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublicAddress(host)) return null;
    if (websiteUrl && new URL(websiteUrl).origin !== url.origin) return null;
    return url.href;
  } catch { return null; }
}
export function verifiedChatActions(context: ResolvedContext) {
  const scope = { websiteId: context.websiteId, websiteUrl: context.instructions.websiteUrl, businessName: context.instructions.businessName };
  const configured = context.businessActions ?? [];
  const actions = configured.filter(action => action.authority && action.authority.websiteId === context.websiteId
    && configured.filter(other => other.actionId === action.actionId).length === 1);
  return {
    booking: actions.filter(action => action.destinationType === 'URL' && ['appointment', 'demo'].includes(actionPurpose(action, scope) ?? '')),
    contact: actions.filter(action => ['URL', 'EMAIL', 'PHONE', 'WHATSAPP'].includes(action.destinationType) && ['contact', 'support'].includes(actionPurpose(action, scope) ?? '')),
    navigation: {
      pricing: actions.filter(action => action.destinationType === 'URL' && actionPurpose(action, scope) === 'pricing'),
      services: actions.filter(action => action.destinationType === 'URL' && ['product', 'learn'].includes(actionPurpose(action, scope) ?? '') && /\/services\/?(?:[?#]|$)/iu.test(action.destination)),
    },
  };
}
function question(query: string) {
  const value = semantics(query);
  if (broadCatalogQuery(query) === 'service') return { kind: 'service_overview', topic: 'services' };
  if (/^(?:hi|hello|hey|thanks|thank you|ok|okay|yes|no|नमस्ते|धन्यवाद|namaste|shukriya)[.!?।]*$/u.test(value)) return { kind: 'conversation', topic: 'your question' };
  if (/^(?:contact(?: details| information)?|phone(?: number)?|email(?: address)?)[.!?]*$/u.test(value) || /(?:contact|phone|email).*(?:details|number|address)|(?:how|where).*contact/u.test(value)) return { kind: 'contact', topic: 'contact details' };
  if (/^(?:(?:your|all|available)\s+)?services(?: list)?[.!?]*$/u.test(value) || /what (?:services|treatments).*offer|(?:services|treatments).*batao/u.test(value)) return { kind: 'service_overview', topic: 'services' };
  if (/\b(?:book|request|schedule) (?:a )?demo\b/u.test(value)) return { kind: 'demo', topic: 'a product demo' };
  if (/\b(?:slots?|availability|available (?:consultation|appointment) times|appointment times|खाली समय|उपलब्ध समय)\b|कौन सा समय/u.test(value)) return { kind: 'live_slots', topic: 'appointment availability' };
  if (/checklist|guide|document|resource|चेकलिस्ट|गाइड|संसाधन/iu.test(value)) return { kind: 'resource', topic: 'the requested resource' };
  if (/\b(?:emailed|email me|send .*email|deliver|delivery)\b|ईमेल.*भेज/iu.test(value)) return { kind: 'delivery', topic: 'email delivery' };
  if (/\bfree\b/u.test(value)) return { kind: 'service', topic: /consultation/u.test(value) ? 'free consultation' : value.match(/\bfree\s+[\p{L}]+/u)?.[0] ?? 'the free offer' };
  if (/refund|refundable|wapas|वापस|रिफंड/iu.test(value)) return { kind: 'refund', topic: /consultation/.test(value) ? 'consultation fees' : 'refund policy' };
  if (/cancel|cancellation|radd|रद्द/iu.test(value)) return { kind: 'cancellation', topic: 'appointment cancellation' };
  if (/\b(?:where|link|url)\b.*\bbook|\bbook.*\b(?:link|url)\b|बुकिंग लिंक/iu.test(value)) return { kind: 'booking_link', topic: 'booking link' };
  if (/\bbook(?:ing)?\b|बुकिंग/iu.test(value)) return { kind: 'booking', topic: 'online booking' };
  if (/open|hours|closed|khul|band|खुल|बंद|समय/iu.test(value)) return { kind: /\b(?:kal|aaj|today|tomorrow)\b|आज|कल/u.test(value) ? 'relative_hours' : 'hours', topic: 'opening hours' };
  if (/price|pricing|cost|how much|kitn|daam|rupay|rupee|कीमत|रुपये|सफाई.*शुरू|कितन/iu.test(value)) {
    const subject = /dental cleaning/.test(value) ? 'dental cleaning' : /root canal/.test(value) ? 'root canal treatment' : terms(value).join(' ');
    return { kind: 'price', topic: subject || 'treatment price' };
  }
  if (/dental implant/.test(value)) return { kind: 'service', topic: 'dental implant' };
  if (/home treatment/.test(value)) return { kind: 'service', topic: 'home treatment' };
  if (/emergency dental treatment/.test(value)) return { kind: 'service', topic: 'emergency dental treatment' };
  const service = value.match(/(?:do you (?:offer|provide)|is (.+?) available)\s*(.*?)\??$/u);
  if (service) return { kind: 'service', topic: service[1] || service[2] };
  return { kind: 'general', topic: terms(query).join(' ').slice(0, 100) || 'your question' };
}
export function buildChatSafetyPlan(context: ResolvedContext, query: string, language: ChatLanguageState, leadCapture = false): ChatSafetyPlan {
  const target = question(query), facts: ChatFact[] = [], opaque: string[] = [];
  const structural: ChatFact[] = [];
  for (const chunk of context.chunks) {
    if (!safeChatSourceUrl(chunk.url, context.instructions.websiteUrl)) continue;
    if (UNSAFE_SOURCE.test(chunk.content) || ('truncated' in chunk && chunk.truncated)) { opaque.push(chunk.content); continue; }
    const records = priceRecords(chunk);
    for (const record of records) structural.push({ kind: 'price', subject: record.subject, value: `${record.amount}|${record.qualification}`, text: record.text, chunk, negative: false, amount: record.amount, suffix: record.qualification ? ` (${record.qualification})` : '' });
    if (target.kind === 'contact' && (chunk.pageType === 'contact' || /\/contact\/?$/u.test(chunk.page))) {
      for (const line of chunk.content.split('\n')) {
        const separated = line.replace(/(?<=[a-z])(?=[A-Z][a-z])/gu, ' ').replace(/([A-Z]{2,})(?=[a-z][\w.+-]*@)/gu, '$1 ');
        const phone = separated.match(/\(\d{3}\)\s*\d{3}-\d{4}/u), email = separated.match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu);
        if (phone || email) {
          const value = phone?.[0] ?? email![0];
          const text = separated.replace(value, ` ${value} — `).replace(/\s+/gu, ' ').trim();
          if (text.length <= 260) facts.push({ kind: 'contact', subject: 'contact details', value: text, text, chunk, negative: false });
        }
      }
    }
    for (const paragraph of chunk.content.split(/\n\s*\n/u)) {
      if (records.some(record => record.raw === paragraph)) continue;
      const sentences = paragraph.trim().split(/(?<=[.!?।])\s+(?=[\p{L}])/u);
      const parsed = sentences.map(text => parseFact(text, chunk));
      // Entire paragraph is the qualification boundary; opaque related text never promotes certainty.
      if (parsed.some(fact => !fact)) opaque.push(paragraph);
      else facts.push(...parsed.filter((fact): fact is ChatFact => Boolean(fact)));
    }
  }
  facts.push(...structural);
  let selected = facts.filter(fact => target.kind === 'hours' || target.kind === 'relative_hours' ? ['hours', 'closed'].includes(fact.kind)
    : target.kind === 'booking_link' ? fact.kind === 'booking'
    : target.kind === fact.kind && (['cancellation', 'booking', 'contact'].includes(fact.kind) || target.kind === 'refund' && target.topic === 'refund policy' || sameSubject(target.topic, fact.subject) || fact.kind === 'price' && matchesSubject(query, fact.subject)));
  if (target.kind === 'general') selected = structural.filter(fact => matchesSubject(query, fact.subject));
  if (target.kind === 'service' && !/free|मुफ्त/iu.test(query)) selected.push(...structural.filter(fact => matchesSubject(query, fact.subject)).map(fact => ({ ...fact, kind: 'service' as const, value: 'yes', text: `${fact.subject} is available.` })));
  if (target.kind === 'service_overview') selected = [...facts.filter(f => f.kind === 'service'), ...structural.map(fact => ({ ...fact, kind: 'service' as const, value: 'yes', text: `${fact.subject} is available.` }))];
  if (target.kind === 'hours' && /sunday|रविवार/iu.test(semantics(query))) selected = selected.filter(fact => fact.kind === 'closed' || /sunday/i.test(fact.value));
  if (target.kind === 'price' && broadCatalogQuery(query) === 'price') selected = facts.filter(fact => fact.kind === 'price');
  // Refund policy cannot establish a free consultation, booking text cannot establish live slots.
  const conflicting = selected.some(fact => fact.kind !== 'contact' && selected.some(other => fact.kind === other.kind && sameSubject(fact.subject, other.subject) && normalized(fact.value) !== normalized(other.value)));
  const retrievalConflict=Boolean(context.retrieval?.conflicts.some(conflict=>
    (target.kind==='general'||target.kind===conflict.kind||target.kind==='service_overview'&&conflict.kind==='service'||target.kind==='refund'&&conflict.kind==='refund')
    && (target.kind==='refund'&&target.topic==='refund policy'||sameSubject(target.topic,conflict.subject)||selected.some(f=>sameSubject(f.subject,conflict.subject))||target.kind==='general'&&terms(conflict.subject).some(word=>terms(query).includes(word)))));
  const opaqueRelated = opaque.some(text => {
    // Descriptions of an offered service do not contradict its structural price
    // record. Other money/conditions and unsafe source text still fail closed.
    if (selected.some(f => structural.includes(f)) || target.kind === 'service_overview' && selected.length) {
      if (!/[$₹€£¥]\s*\d|\b(?:USD|INR|EUR|GBP|CAD|AUD)\s*\d/iu.test(text) && !selected.some(f => f.chunk.content.includes(text))) return false;
      if (!/[$₹€£¥]\s*\d|\b(?:USD|INR|EUR|GBP|CAD|AUD)\s*\d|\bonly\b|subject to|excluding|conditions apply|not (?:available|offered)/iu.test(text)) return false;
    }
    const subjects = selected.length ? selected.map(fact => fact.subject) : [target.topic];
    return subjects.some(subject => { const relevant = terms(subject); return relevant.length > 0 && relevant.every(word => semantics(text).includes(word)); });
  });
  const actions = verifiedChatActions(context);
  // A dental appointment must not fulfill a product-demo request. Preserve
  // valid demo navigation for businesses that actually configured it.
  if (target.kind === 'demo') actions.booking = actions.booking.filter(action => actionPurpose(action, { websiteId: context.websiteId, websiteUrl: context.instructions.websiteUrl, businessName: context.business.name }) === 'demo');
  let state: AnswerState = conflicting||retrievalConflict ? 'contradictory' : selected.length && !opaqueRelated ? selected.every(fact => fact.negative) ? 'known_negative' : 'known_positive' : 'unknown';
  if (target.kind === 'price' && selected.length > 1 && subjectTerms(query).length && new Set(selected.map(f => normalized(f.subject))).size > 1) state = 'ambiguous';
  if (target.kind === 'relative_hours' || target.kind === 'price' && !selected.length && /^(treatment price|lagega)$/u.test(target.topic) || /^(?:it|this|that)$/u.test(target.topic)) state = 'ambiguous';
  // Keep the entire qualification boundary; never shorten a page by cutting
  // off conditions. Long pages need a targeted answer or verified navigation.
  const excerpts = (target.kind === 'general' || target.kind === 'service' && /explain|detail|about|samjhao/iu.test(query)) && !retrievalConflict && !conflicting && (!selected.length || /explain|detail|about|samjhao/iu.test(query)) ? context.chunks.filter(chunk => safeChatSourceUrl(chunk.url, context.instructions.websiteUrl) && !('truncated' in chunk && chunk.truncated) && !UNSAFE_SOURCE.test(chunk.content)).flatMap(chunk => chunk.content.split(/\n\s*\n/u).filter(paragraph => paragraph.length <= 600 && /[.!?।]$/u.test(paragraph.trim()) && !/[$₹€£¥]\s*\d/u.test(paragraph) && matchesSubject(query, paragraph)).map(content => ({ ...chunk, content }))).slice(0, /detail/iu.test(query) ? 3 : 1) : [];
  if (excerpts.length) state = 'known_positive';
  if (target.kind === 'booking_link' && actions.booking.length) state = selected.some(fact => fact.negative) || conflicting ? 'contradictory' : 'known_positive';
  if (target.kind === 'conversation') state = 'known_positive';
  if (target.kind === 'demo' && actions.booking.length) state = facts.some(fact => fact.kind === 'service' && fact.negative && /\bdemo\b/iu.test(fact.subject)) ? 'contradictory' : 'known_positive';
  // Broad answers remain bounded; detailed questions can request more rows.
  if (!/detail|all|complete|full|saare/iu.test(query) && selected.length > 6) selected = selected.slice(0, 6);
  return { state, query, topic: target.topic, kind: target.kind, language, businessName: context.business.name, facts, selected, excerpts,
    evidenceStatus: state.startsWith('known') ? 'answer_available' : state === 'contradictory' || opaqueRelated ? 'safety_rejected' : context.chunks.some(c => matchesSubject(query, c.content)) ? 'parser_miss' : 'answer_unavailable',
    ...actions, leadCapture, leadOffer: leadCapture && ['price', 'booking', 'booking_link', 'service'].includes(target.kind) && state.startsWith('known') && (selected.some(f => !f.negative) || actions.booking.length > 0),
    contactSubmission: /^[^\n]*[\w.+-]+@[\w.-]+\.[a-z]{2,}[^\n]*$/iu.test(query) };
}
function local(plan: ChatSafetyPlan, english: string, hindi: string, hinglish: string): string {
  return plan.language.language === 'Hindi' ? hindi : plan.language.language === 'Hinglish' ? hinglish : english;
}
export function renderChatFact(fact: ChatFact, plan: ChatSafetyPlan): string {
  const subject = fact.subject, value = fact.value;
  if (fact.kind === 'price') return local(plan, fact.text,
    `${subject} की कीमत ${fact.amount}${fact.from ? ' से शुरू होती है' : ' है'}${fact.suffix}।`,
    `${subject} ki price ${fact.amount}${fact.from ? ' se shuru hoti hai' : ' hai'}${fact.suffix}.`);
  if (fact.kind === 'refund') return local(plan, fact.text,
    `${subject} ${fact.negative ? 'वापस नहीं किए जाते' : 'वापस किए जा सकते हैं'}${/^(yes|no)$/.test(value) ? '' : ` (${value.replace(/^(yes|no)/, '')})`}।`,
    `${subject} ${fact.negative ? 'non-refundable hain' : 'refund ho sakte hain'}${/^(yes|no)$/.test(value) ? '' : ` (${value.replace(/^(yes|no)/, '')})`}.`);
  if (fact.kind === 'cancellation') return local(plan, fact.text, `अपॉइंटमेंट रद्द करने के लिए ${value} घंटे पहले सूचना देना ज़रूरी है।`, `Appointment cancel karne ke liye ${value} hours pehle batana zaroori hai.`);
  const hindiEntity = fact.entity === 'clinic' ? 'क्लिनिक' : plan.businessName;
  const romanEntity = fact.entity === 'clinic' ? 'Clinic' : plan.businessName;
  if (fact.kind === 'hours') { const [first, last, start, end] = value.split('|'); return local(plan, fact.text, `${hindiEntity} ${first} से ${last}, ${start} से ${end} तक खुला रहता है।`, `${romanEntity} ${first} se ${last}, ${start} se ${end} tak khula rehta hai.`); }
  if (fact.kind === 'closed') return local(plan, fact.text, `${hindiEntity} ${value} को बंद रहता है।`, `${romanEntity} ${value} ko band rehta hai.`);
  if (fact.kind === 'booking') return local(plan, fact.text, `ऑनलाइन बुकिंग ${fact.negative ? 'उपलब्ध नहीं है' : 'उपलब्ध है'}।`, `Online booking ${fact.negative ? 'available nahi hai' : 'available hai'}.`);
  return local(plan, fact.text, `${subject} ${fact.negative ? 'उपलब्ध नहीं है' : 'उपलब्ध है'}।`, `${subject} ${fact.negative ? 'offer nahi kiya jata' : 'available hai'}.`);
}
export function composeSafeChatReply(plan: ChatSafetyPlan): string {
  const translated = safetyLanguageCopy(plan.language.language);
  if (translated) {
    const index = plan.state === 'contradictory' ? 1 : plan.state === 'ambiguous' || plan.kind === 'conversation' ? 2 : plan.state.startsWith('known') ? 3 : 0;
    const facts = index === 3 ? [...plan.selected.map(fact => fact.text), ...plan.excerpts.map(chunk => chunk.content)].map(text => `“${text}”`).join('\n') : plan.topic;
    const destinations = [...(plan.state === 'known_positive' ? plan.booking : []), ...plan.contact].map(action => action.destination).join('\n');
    return `${translated[index]} ${facts}${destinations ? `\n${destinations}` : ''}`.trim();
  }
  if (plan.kind === 'conversation') return local(plan, 'How can I help with your questions about the business?', 'व्यवसाय के बारे में आपके सवालों में कैसे मदद कर सकता हूँ?', 'Business ke baare mein aapke sawaalon mein kaise help kar sakta hoon?');
  if (plan.contactSubmission) return plan.leadCapture
    ? local(plan, 'Thank you for sharing your email for follow-up. Saving contact details does not send email or complete a booking.', 'फ़ॉलो-अप के लिए email साझा करने के लिए धन्यवाद। संपर्क जानकारी दर्ज करने से ईमेल नहीं भेजा जाता और बुकिंग पूरी नहीं होती।', 'Follow-up ke liye email share karne ke liye shukriya. Contact details save karne se email nahi bheja jata aur booking complete nahi hoti.')
    : local(plan, 'Contact capture is unavailable here. Please use a verified business contact route.', 'यहाँ संपर्क जानकारी दर्ज करने की सुविधा उपलब्ध नहीं है। कृपया व्यवसाय के सत्यापित संपर्क माध्यम का उपयोग करें।', 'Yahan contact details save karne ki suvidha available nahi hai. Business ka verified contact route use karein.');
  if (plan.kind === 'contact' && !plan.selected.length && plan.contact[0]) return `${local(plan, 'You can contact the business here:', 'व्यवसाय से यहाँ संपर्क कर सकते हैं:', 'Business se yahan contact kar sakte hain:')} ${plan.contact[0].destination}`;
  if (plan.kind === 'demo' && plan.state === 'known_positive' && plan.booking[0]) return `${local(plan, 'You can request a demo here:', 'डेमो का अनुरोध यहाँ कर सकते हैं:', 'Demo yahan request kar sakte hain:')} ${plan.booking[0].destination}`;
  if (plan.state !== 'contradictory' && !plan.selected.length && (plan.kind === 'service_overview' || plan.kind === 'price')) {
    const action = (plan.kind === 'price' ? plan.navigation.pricing : plan.navigation.services)[0];
    if (action && !subjectTerms(plan.query).length) return `${local(plan, plan.kind === 'price' ? 'You can view pricing here:' : 'You can explore services here:', plan.kind === 'price' ? 'कीमतों की जानकारी यहाँ देखें:' : 'सेवाओं की जानकारी यहाँ देखें:', plan.kind === 'price' ? 'Pricing yahan dekh sakte hain:' : 'Services yahan dekh sakte hain:')} ${action.destination}\n${local(plan, 'Which treatment or service are you interested in?', 'आप किस उपचार या सेवा के बारे में जानना चाहते हैं?', 'Aap kis treatment ya service ke baare mein jaanna chahte hain?')}`;
    if (plan.kind === 'service_overview') return local(plan, 'Which treatment or service would you like to know about?', 'आप किस उपचार या सेवा के बारे में जानना चाहते हैं?', 'Aap kis treatment ya service ke baare mein jaanna chahte hain?');
  }
  let text: string;
  if (plan.state === 'contradictory') text = local(plan, `The retrieved information about ${plan.topic} conflicts. Please confirm the current policy with the business.`, `${plan.topic} की मिली जानकारी में विरोध है। कृपया वर्तमान नीति की पुष्टि करें।`, `${plan.topic} ki mili jaankari mein conflict hai. Current policy business se confirm karna behtar hoga.`);
  else if (plan.state === 'ambiguous') text = local(plan, plan.kind === 'relative_hours' ? 'Which date do you mean? I can share the published weekly hours, but cannot confirm live availability.' : 'Which treatment or service do you mean? Prices depend on the specific service.', plan.kind === 'relative_hours' ? 'आप किस तारीख के बारे में पूछ रहे हैं? साप्ताहिक समय बता सकता हूँ, लेकिन लाइव उपलब्धता की पुष्टि नहीं कर सकता।' : 'आप किस उपचार या सेवा की कीमत पूछ रहे हैं?', plan.kind === 'relative_hours' ? 'Aap kis date ki baat kar rahe hain? Weekly hours bata sakta hoon, lekin live availability confirm nahi kar sakta.' : 'Aap kis treatment ya service ki price pooch rahe hain?');
  else if (plan.state === 'unknown') text = local(plan, `I couldn't find confirmed information about ${plan.topic}. Please contact the business to check.`, `${plan.topic} के बारे में मेरे पास पुष्ट जानकारी नहीं है। कृपया इसकी पुष्टि के लिए संपर्क करें।`, `${plan.topic} ke baare mein mere paas confirmed jaankari nahi hai. Business se confirm karna behtar hoga.`);
  else text = [...new Set(plan.selected.map(fact => fact.kind === 'contact' ? fact.text : renderChatFact(fact, plan)))].join(plan.selected.length > 2 ? '\n' : ' ');
  if (plan.state.startsWith('known') && plan.kind === 'service_overview') text = local(plan, 'Published services include:', 'प्रकाशित सेवाओं में शामिल हैं:', 'Published services mein shamil hain:') + '\n' + text;
  if (plan.state.startsWith('known') && plan.kind === 'price' && !subjectTerms(plan.query).length && plan.selected.length > 1) text = local(plan, 'Some published fees:', 'कुछ प्रकाशित शुल्क:', 'Kuch published fees:') + '\n' + text;
  if (plan.excerpts.length) text = local(plan, 'The retrieved source says:', 'मिले स्रोत में लिखा है:', 'Mile source mein likha hai:') + '\n' + plan.excerpts.map(chunk => `“${chunk.content}”`).join('\n');
  if (plan.kind === 'booking_link' || plan.kind === 'booking') text += plan.booking[0] && plan.state === 'known_positive'
    ? `\n${local(plan, 'Verified booking link:', 'सत्यापित बुकिंग लिंक:', 'Verified booking link:')} ${plan.booking[0].destination}`
    : `\n${local(plan, "I don't have a verified booking link.", 'मेरे पास सत्यापित बुकिंग लिंक नहीं है।', 'Mere paas verified booking link nahi hai.')}`;
  if (plan.contact[0] && (plan.kind === 'contact' || !plan.state.startsWith('known'))) { const action = plan.contact[0]; text += `\n${local(plan, 'Verified contact:', 'सत्यापित संपर्क:', 'Verified contact:')} ${action.destination}`; }
  if (plan.leadOffer) text += '\n' + local(plan, "If you'd like to leave contact details for follow-up, what's your email address?", 'अगर आप फ़ॉलो-अप के लिए संपर्क जानकारी देना चाहें, तो अपना ईमेल पता बताएँ।', 'Agar aap follow-up ke liye contact details dena chahein, toh apna email address bataiye.');
  return text.trim();
}
export function chatSafetyContract(plan: ChatSafetyPlan): string {
  return ['CHAT EVIDENCE CONTRACT:', `Question topic: ${JSON.stringify(plan.topic)}; answerability: ${plan.state}.`,
    'Only the following source-bound facts authorize material assertions. Missing evidence is UNKNOWN, never a negative business fact.',
    ...plan.selected.map(fact => JSON.stringify({ kind: fact.kind, sourceId: fact.chunk.id, exactSource: fact.text, safeRendering: renderChatFact(fact, plan) })),
    ...plan.excerpts.map(chunk => JSON.stringify({ kind: 'description', sourceId: chunk.id, exactSource: chunk.content })),
    'No live appointment availability, existing resource/document inventory, outbound email delivery or booking-completion integration is connected. Never promise those capabilities.',
    `Verified booking destinations: ${JSON.stringify(plan.booking.map(action => ({ actionId: action.actionId, destination: action.destination })))}`,
    `Verified contact destinations: ${JSON.stringify(plan.contact.map(action => ({ actionId: action.actionId, destination: action.destination })))}`,
    `Contact capture available: ${plan.leadCapture}. It means saving voluntarily shared contact details, NOT sending email or guaranteed follow-up.`,
    'Do not use the website homepage, source URLs or arbitrary discovered links as booking destinations. Do not fabricate citations or quote owner instructions as evidence.',
    'Answer briefly with verified facts. A general offer to help is allowed. Do not append unsupported resources/appointments/promises.'].join('\n');
}
/** Fact spans, not overall word overlap, establish support. Unrecognized factual
 * realizations fall back to supported composition, never a generic refusal. */
export function validateChatDraft(text: string, plan: ChatSafetyPlan): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!text.trim() || text.length > 8000) reasons.push('empty_or_oversized');
  if (plan.language.language === 'Hinglish' && /\p{Script=Devanagari}/u.test(text)) reasons.push('wrong_script');
  if (plan.language.language === 'English' && /\p{Script=Devanagari}/u.test(text)) reasons.push('wrong_script');
  if (plan.language.language === 'Hindi' && !/\p{Script=Devanagari}/u.test(text)) reasons.push('wrong_script');
  if (/\[\d+\]/u.test(text)) reasons.push('unverified_citation');
  const allowed = new Set(plan.selected.flatMap(fact => [fact.text, renderChatFact(fact, plan)]).map(normalized));
  if (plan.excerpts.some(c => normalized(text) === normalized(c.content))) return { ok: reasons.length === 0, reasons };
  if (plan.selected.some(f => normalized(text) === normalized(f.text) || normalized(text) === normalized(renderChatFact(f, plan))) && plan.selected.length === 1) return { ok: reasons.length === 0, reasons };
  const clauses = text.trim().split(/(?<=[.!?।])\s+(?=[\p{L}])/u);
  for (const clause of clauses) {
    // Do not discard yes/no: an inconsistent polarity prefix can change meaning.
    const trimmed = clause.trim();
    const parsed = parseFact(trimmed, {} as RetrievedChunk);
    const sourceMatch = parsed && plan.selected.some(fact => fact.kind === parsed.kind && sameSubject(fact.subject, parsed.subject) && normalized(fact.value) === normalized(parsed.value));
    const safeHelp = /^(?:Would you like help contacting (?:the business|the clinic|our team)\?|How can I help\?|Can I help with another question\?|क्या आप संपर्क करने में मदद चाहेंगे\?|Kya aap contact karne mein help chahenge\?)$/iu.test(trimmed);
    if (!allowed.has(normalized(trimmed)) && !sourceMatch && !safeHelp) reasons.push('unverified_claim_or_capability');
  }
  // A draft cannot replace a verified answer with an evasive generic sentence.
  if (!plan.selected.some(fact => normalized(text).includes(normalized(fact.text)) || normalized(text).includes(normalized(renderChatFact(fact, plan))))) reasons.push('missing_supported_answer');
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}
