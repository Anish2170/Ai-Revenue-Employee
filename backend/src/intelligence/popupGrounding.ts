import { creativeTitle, creativeBody, type CopyLanguage } from './creativePopupCopy.js';
import type { BusinessInstructions } from '../context/types.js';
import type { StrategyKnowledgeResult } from './knowledgeRetrieval.js';

export interface PopupEvidence { chunkId: string; page: string; url: string; statement: string }
export interface GroundedCopy { text: string; evidence: PopupEvidence[] }
export interface PopupCopyPlan { titles: string[]; bodies: GroundedCopy[]; conflicts: string[]; mode: 'source_bound_v1'; language: CopyLanguage }
export interface PopupGroundingContext { pagePath?: string }
interface Fact { key: string; value: string; variants: string[]; evidence: PopupEvidence }

// This is an explicit authoring contract, not a claim that arbitrary natural
// language can be verified with keywords. Unsupported prose fails closed.
const TITLES = ['Need help?', 'Need a hand?', 'Questions?', 'Questions about our team?', 'Pricing help', 'Help comparing options', 'Want help choosing the next step?', 'Pricing that fits your workflow'];
const INVITATIONS = [
  'Need help comparing pricing options?', 'Want help comparing plans?',
  'Would you like help finding the relevant information?', 'Want help choosing the next step?',
  'Our team can help with your questions.', 'Our team can help answer questions about the next step.',
  'Tell us what you are trying to improve and we can point you in the right direction.',
  'Would you like help booking an appointment?', 'Would you like help exploring the collection?',
  'Would you like help arranging a demo?', 'Would you like help understanding our services?',
];
const MONEY = String.raw`(?:[$€£₹¥]\s*\d[\d.,\u00a0\u202f]*|(?:USD|EUR|GBP|INR|JPY|CAD|AUD|Rs\.?)\s*\d[\d.,\u00a0\u202f]*|\d[\d.,\u00a0\u202f]*\s*(?:USD|EUR|GBP|INR|JPY|CAD|AUD|dollars?|rupees?))`;
const PRICE = new RegExp(String.raw`^([\p{L}\p{N}][\p{L}\p{N} '&()-]{0,79}?)\s+(costs?|is priced at|starts at)\s+(${MONEY})(.*)\.$`, 'iu');
const PRICE_SUFFIX = /^(?:(?:\s*\/(?:mo|month|yr|year))|(?:\s+(?:per|a) (?:month|year|visit|session|item))|(?:,?\s+(?:billed (?:annually|monthly)|(?:including|excluding) (?:tax|VAT)|for (?:new|existing) customers)))*$/i;
const POLICY = /^(Refunds?|Returns?|Cancellations?)\s+(?:(?:are|is)\s+)?(not available|unavailable|available|not accepted|accepted|not allowed|allowed|not offered|offered)(\s+within\s+\d+\s+days)?(\s+for unopened (?:items|products))?\.$/i;
const CUSTOM = /^([\p{L}][\p{L}\p{N} '&()-]{0,79}?) (offers|uses|has) custom pricing( based on ([\p{L} ,'-]+))?\.$/iu;
const BASIS_WORDS = new Set('workflow workflows scope integrations team size usage requirements services and business needs selected plan project complexity'.split(' '));

export function normalizePopupCopy(text: string): string {
  // Keep currencies, numbers, negation and qualifiers. Do not use a bag of words.
  return text.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
}

export function buildPopupCopyPlan(knowledge: StrategyKnowledgeResult, instructions: BusinessInstructions, context: PopupGroundingContext = {}): PopupCopyPlan {
  const language: CopyLanguage = 'english';
  const titles = [...TITLES];
  const invitations = INVITATIONS;
  const bodies: GroundedCopy[] = invitations.map(text => ({ text, evidence: [] }));
  const facts: Fact[] = [];
  const opaque: string[] = [];
  if (knowledge.knowledgeAvailable) for (const chunk of knowledge.chunks) {
    // Promote only self-contained, fully understood source blocks. Selecting a
    // sentence from an arbitrary paragraph could discard a negation, exception,
    // hypothetical example or instruction. Opaque/clipped blocks stay data only.
    if (chunk.truncated || chunk.content.length > 1200 || /[<>\u0000-\u0008]/u.test(chunk.content)) { opaque.push(normalizePopupCopy(chunk.content)); continue; }
    const statements = chunk.content.trim().split(/(?<=\.)\s+(?=[\p{Lu}])/u);
    const parsed = statements.map(statement => parseFact(statement.trim(), {
      chunkId: chunk.id, page: chunk.page, url: chunk.url, statement: statement.trim(),
    }));
    if (parsed.length > 12 || parsed.some(fact => !fact)) { opaque.push(normalizePopupCopy(chunk.content)); continue; }
    facts.push(...parsed.filter((fact): fact is Fact => fact !== null));
  }
  const groups = new Map<string, Fact[]>();
  for (const fact of facts) groups.set(fact.key, [...(groups.get(fact.key) ?? []), fact]);
  const conflicts: string[] = [];
  for (const [key, group] of groups) {
    const entity = key.split(':')[1];
    if (opaque.some(block => block.includes(entity)) || new Set(group.map(fact => fact.value)).size > 1) { conflicts.push(key); continue; }
    // Static knowledge cannot establish live inventory/availability. Supported
    // source facts also require the current page binding when one is supplied.
    const relevant = group.filter(fact => !context.pagePath || samePage(context.pagePath, fact.evidence.page));
    for (const fact of relevant.slice(0, 1)) for (const text of fact.variants) {
      if (text.length > 320 || bodies.some(body => normalizePopupCopy(body.text) === normalizePopupCopy(text))) continue;
      bodies.push({ text, evidence: relevant.map(item => item.evidence) });
    }
    if (bodies.length >= 23) break;
  }
  return { mode: 'source_bound_v1', language, titles, bodies, conflicts };
}

/** English predicates/qualifiers are parsed below; proper Latin-script entity
 * names remain literal (including accents). This is not a universal language detector. */
function englishFactSubject(subject: string): boolean {
  return /^[\p{Script=Latin}\p{N} '&()-]+$/u.test(subject)
    && !/\b(aapki|aapka|aapke|apni|apna|kya|kitne|ka|ki|ke|hai|hain|votre|notre|precio|precios|prix|nuestro|nuestra)\b/iu.test(subject);
}

function parseFact(statement: string, evidence: PopupEvidence): Fact | null {
  if (/\b(ignore|instruction|system|assistant|example|hypothetical|pretend|not|never|previous|override)\b/i.test(statement) && !POLICY.test(statement)) return null;
  const price = statement.match(PRICE);
  if (price && englishFactSubject(price[1]) && PRICE_SUFFIX.test(price[4]) && (statement.match(new RegExp(MONEY, 'giu')) ?? []).length === 1) {
    const [, subject, verb, amount, suffix] = price;
    const unit = suffix.match(/\b(month|mo|year|yr|visit|session|item)\b/i)?.[0].toLowerCase().replace(/^mo$/, 'month').replace(/^yr$/, 'year') ?? 'once';
    const variants = verb.toLowerCase() === 'starts at' ? [statement] : [statement, `${subject} ${verb.toLowerCase() === 'is priced at' ? 'costs' : 'is priced at'} ${amount}${suffix}.`];
    if (verb.toLowerCase() !== 'starts at') variants.push(`${subject}: ${amount}${suffix}.`, `For ${subject}, the price is ${amount}${suffix}.`);
    // Qualifiers participate in conflict detection and are always copied whole.
    return { key: `price:${normalizePopupCopy(subject)}:${unit}`, value: `${normalizeAmount(amount)}:${normalizePopupCopy(suffix)}:${verb.toLowerCase() === 'starts at' ? 'from' : 'exact'}`, variants, evidence };
  }
  const policy = statement.match(POLICY);
  if (policy) {
    const noun = policy[1].toLowerCase().replace(/s$/, '');
    const negative = /^(not |unavailable)/i.test(policy[2]);
    return { key: `policy:${noun}`, value: `${negative ? 'no' : 'yes'}:${normalizePopupCopy((policy[3] ?? '') + (policy[4] ?? ''))}`, variants: negative && !policy[3] && !policy[4] ? [statement, `We do not offer ${noun}s.`] : [statement], evidence };
  }
  const custom = statement.match(CUSTOM);
  if (custom && englishFactSubject(custom[1]) && (!custom[4] || custom[4].toLowerCase().split(/[ ,]+/).every(word => BASIS_WORDS.has(word)))) {
    return { key: `custom-price:${normalizePopupCopy(custom[1])}`, value: normalizePopupCopy(custom[3] ?? ''),
      variants: [statement, `${custom[1]} ${custom[2] === 'uses' ? 'offers' : 'uses'} custom pricing${custom[3] ?? ''}.`], evidence };
  }
  return null;
}

function normalizeAmount(raw: string): string {
  const normalized = raw.normalize('NFKC').replace(/\s/g, '').toUpperCase();
  // Only compare source records; rendering never converts a currency or locale.
  const amount = normalized.match(/\d[\d.,]*/)?.[0] ?? '';
  const decimal = /[.,]\d{1,2}$/.test(amount) ? amount.slice(-3).match(/[.,]/)?.[0] : undefined;
  const numeric = decimal ? amount.slice(0, amount.lastIndexOf(decimal)).replace(/[.,]/g, '') + '.' + amount.slice(amount.lastIndexOf(decimal) + 1) : amount.replace(/[.,]/g, '');
  return normalized.replace(amount, String(Number(numeric)));
}

function samePage(left: string, right: string): boolean {
  try { return pageKey(left) === pageKey(right); }
  catch { return false; }
}

function pageKey(value: string): string { const url = new URL(value, 'https://scope.invalid'); return url.pathname.replace(/\/$/, '') + url.search + url.hash; }

/** Expansion happens before final length/action checks; internal tokens never reach the widget. */
export function checkPopupGrounding(title: string, body: string, plan: PopupCopyPlan): { ok: boolean; evidence: PopupEvidence[]; body: string } {
  const facts = plan.bodies.filter(item => item.evidence.length > 0);
  let tokens = 0, invalid = false;
  const expanded = body.replace(/\{\{fact:(\d+)\}\}/g, (_token, index) => {
    tokens++;
    const fact = facts[Number(index)];
    if (!fact) { invalid = true; return ''; }
    return fact.text;
  });
  if (invalid || tokens > 1 || /[{}]/u.test(expanded)) return { ok: false, evidence: [], body: expanded };
  const normalized = normalizePopupCopy(expanded);
  const titleOk = plan.titles.some(item => normalizePopupCopy(item) === normalizePopupCopy(title)) || creativeTitle(normalizePopupCopy(title), plan.language);
  const match = plan.bodies.find(item => normalizePopupCopy(item.text) === normalized);
  if (match && titleOk) return { ok: true, evidence: match.evidence, body: expanded };
  if (titleOk && creativeBody(normalized, plan.language)) return { ok: true, evidence: [], body: expanded };
  if (titleOk) for (const fact of facts) {
    const atom = normalizePopupCopy(fact.text);
    const rest = normalized.startsWith(atom + ' ') ? normalized.slice(atom.length).trim()
      : normalized.endsWith(' ' + atom) ? normalized.slice(0, -atom.length).trim() : '';
    if (rest && creativeBody(rest, plan.language, 1)) return { ok: true, evidence: fact.evidence, body: expanded };
  }
  return { ok: false, evidence: [], body: expanded };
}
