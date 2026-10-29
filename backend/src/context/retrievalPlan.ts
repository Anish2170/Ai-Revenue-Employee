/** Deterministic query intent/topic hints. Metadata and visitor questions are
 * relevance hints only: no fact values, authority or capabilities are inferred. */
import { normalizeUrl } from '../crawler/links.js';
import type { RetrievedChunk } from './types.js';
export type EvidenceNeed = 'price' | 'features' | 'refund' | 'cancellation' | 'hours' | 'process' | 'booking' | 'service';
export interface RetrievalPage {
    url?: string;
    path?: string;
    title?: string;
}
export interface QueryPlan {
    originalQuery: string;
    searchQuery: string;
    needs: EvidenceNeed[];
    subjects: string[];
    pageUrl: string | null;
    topicSource: 'explicit' | 'page' | 'visitor_history' | 'none';
    ambiguous: boolean;
}
export interface EvidenceConflict {
    kind: 'price' | 'service' | 'refund';
    subject: string;
    sourceIds: string[];
    urls: string[];
}
export interface RetrievalDiagnostics {
    originalQuery: string;
    searchQuery: string;
    topicSource: QueryPlan['topicSource'];
    subjects: string[];
    pageUrl: string | null;
    ambiguous: boolean;
    activeVersion?: string;
    candidateCount: number;
    coverage: Array<{
        need: EvidenceNeed;
        status: 'candidate' | 'missing';
        sourceIds: string[];
    }>;
    conflicts: EvidenceConflict[];
    duplicates: Array<{
        keptId: string;
        sourceIds: string[];
    }>;
    ranking: Array<{
        id: string;
        cosine: number;
        rankScore: number;
        reasons: string[];
    }>;
    omitted: Array<{
        id: string;
        reason: string;
    }>;
}
const STOP = new Set(('a an the and or but for to from of in on at per this that these those it its they them their here there my your our you we me us i how what which why when where does do is are can could would should please tell explain about more much want need know cost costs price pricing fee fees plan plans service services product products item items variant variants feature features include includes included inclusion process work works working help information details detail policy policies refund refunds cancellation cancel appointment booking opening hours hour time timing days day open closed compare comparison versus vs with use used currently viewing page website current learn overview learn_more support high medium low hot warm cold researching ready evaluating EvaluatePrice ReducePriceAnxiety Educate supportive helpful direct consultative reassuring basic-info ka ki ke kya hai hain ho hota hoti kitna kitne aap aapki mein ko karne rule se shuru he rehta batao bata samjhao samjhaao aur daam lagega क्या की का के है हैं में कितना कितने कीमत रुपये शुरू होती और बताओ समझाओ कैसे यह इस उसके इसमें').split(/\s+/).map(s => s.toLowerCase()));
const ALIASES: Array<[
    RegExp,
    string
]> = [[/प्रीमियम/gu, 'premium'], [/बेसिक/gu, 'basic'], [/डीलक्स/gu, 'deluxe'], [/स्टैंडर्ड/gu, 'standard'], [/मॉड्यूलर/gu, 'modular'], [/किचन/gu, 'kitchen'], [/बेडरूम/gu, 'bedroom'], [/दांतों की सफाई|दाँतों की सफाई|teeth cleaning|daant(?:on|o)? ki safa[iy]i/giu, 'dental cleaning'], [/रूट कैनाल/gu, 'root canal'], [/परामर्श/gu, 'consultation']];
export function normalizedTerms(text: string): string[] {
    let value = text.normalize('NFKC').toLowerCase();
    for (const [pattern, replacement] of ALIASES)
        value = value.replace(pattern, replacement);
    return [...new Set((value.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).map(word => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))];
}
// "Medium" also identifies a product variant, not just a confidence band.
STOP.delete('medium');
export function topicTerms(text: string): string[] { return normalizedTerms(text).filter(word => !STOP.has(word) && !/^\d+$/.test(word)); }
export function requestedNeeds(query: string): EvidenceNeed[] {
    const rules: Array<[
        EvidenceNeed,
        RegExp
    ]> = [['price', /price|pricing|cost|how much|kitn|daam|lagega|कीमत|कितन|रुपये/iu], ['features', /feature|include|included|comes with|comparison|compare|क्या मिलता|शामिल|kya milta/iu], ['refund', /refund|return policy|refundable|wapas|वापस|रिफंड/iu], ['cancellation', /cancel|cancellation|radd|रद्द/iu], ['hours', /hours|opens?|closed|timing|khul|band|खुल|समय|बंद/iu], ['process', /process|how .*work|steps|kaise|कैसे/iu], ['booking', /book(?:ing)?|appointment|बुकिंग/iu]];
    const needs = rules.filter(([, rule]) => rule.test(query)).map(([need]) => need);
    if (!needs.includes('booking') && /do you (?:offer|provide)|\bis .*available|milta hai|उपलब्ध|देते हैं/iu.test(query))
        needs.push('service');
    return needs.slice(0, 4);
}
export function chunkNeeds(chunk: Pick<RetrievedChunk, 'heading' | 'content' | 'page'>): EvidenceNeed[] {
    const text = chunk.heading + ' ' + chunk.content, needs = requestedNeeds(text);
    if (/[$₹€£¥]\s*\d|\b(?:USD|INR|EUR|GBP)\s*\d/iu.test(text) && !needs.includes('price'))
        needs.push('price');
    if (/includes?|features?|comes with/iu.test(text) && !needs.includes('features'))
        needs.push('features');
    if (/process|steps|measurement|assessment|installation|layout consultation/iu.test(text) && !needs.includes('process'))
        needs.push('process');
    if (/(?:not )?(?:offered|provided|available)\b/iu.test(text))
        needs.push('service');
    return [...new Set(needs)];
}
export function pageIdentity(page: RetrievalPage | undefined, sourceUrl: string | undefined): string | null {
    if (!page || !sourceUrl)
        return null;
    const normalized = normalizeUrl(page.url ?? page.path ?? '', sourceUrl);
    try {
        return normalized && new URL(normalized).origin === new URL(sourceUrl).origin ? normalized : null;
    }
    catch {
        return null;
    }
}
function labels(chunks: RetrievedChunk[]): Array<{
    name: string;
    tokens: string[];
}> {
    const found = new Map<string, {
        name: string;
        tokens: string[];
    }>();
    for (const chunk of chunks) {
        const names = [chunk.heading];
        // Titles and path labels can give a subject when the local section is generic.
        if (!topicTerms(chunk.heading).length) {
            try {
                names.push(decodeURIComponent(new URL(chunk.url).pathname.split('/').filter(Boolean).at(-1) ?? '').replace(/[-_]/g, ' '));
            }
            catch { }
        }
        for (const name of names) {
            if (name.length > 100 || /public contact|footer|navigation|privacy|terms|contact|refund|cancellation|opening hours|policy|faq|^about$/iu.test(name))
                continue;
            const tokens = topicTerms(name);
            if (!tokens.length || tokens.length > 8)
                continue;
            const key = [...tokens].sort().join(' ');
            if (!found.has(key))
                found.set(key, { name, tokens });
        }
    }
    return [...found.values()];
}
function matchingLabels(query: string, known: ReturnType<typeof labels>): string[] {
    const terms = topicTerms(query);
    if (!terms.length)
        return [];
    const ranked = known.map(label => ({ label, matched: label.tokens.filter(token => terms.includes(token)).length })).filter(row => row.matched > 0).map(row => ({ ...row, score: row.matched === row.label.tokens.length ? 3 + row.matched / 100 : terms.every(token => row.label.tokens.includes(token)) ? 1 + row.matched / row.label.tokens.length : 0 })).filter(row => row.score > 0).sort((a, b) => b.score - a.score);
    if (!ranked.length)
        return [];
    const full = ranked.filter(row => row.score >= 3);
    const selected = full.length ? full.filter(row => /compare|comparison|\bvs\b|versus/iu.test(query) || !full.some(other => other !== row && other.label.tokens.length > row.label.tokens.length && row.label.tokens.every(token => other.label.tokens.includes(token)))) : ranked.filter(row => row.score === ranked[0].score);
    return selected.slice(0, 3).map(row => row.label.name);
}
export function planRetrieval(query: string, chunks: RetrievedChunk[], options: {
    page?: RetrievalPage;
    sourceUrl?: string;
    history?: string[];
    purpose?: 'chat' | 'popup';
} = {}): QueryPlan {
    const known = labels(chunks), pageUrl = pageIdentity(options.page, options.sourceUrl), needs = requestedNeeds(query);
    let subjects = matchingLabels(query, known), topicSource: QueryPlan['topicSource'] = subjects.length ? 'explicit' : 'none';
    const reference = /\b(?:it|its|this|that|these|those|this service|this item|the process)\b|इस|इसका|इसके|ये/iu.test(query) || topicTerms(query).length === 0 || options.purpose === 'popup';
    // Unmatched concrete words may name an unknown product/service. A deictic
    // word alone must not replace that question with a familiar page topic.
    if (!subjects.length && reference && (topicTerms(query).length === 0 || options.purpose === 'popup')) {
        const pageChunks = pageUrl ? chunks.filter(c => normalizeUrl(c.url) === pageUrl && !/public contact|footer|navigation/iu.test(c.heading)) : [];
        const pageLabels = labels(pageChunks);
        const pageReference = /\b(?:this|that|these|those)\b|इस|यह/iu.test(query) || options.purpose === 'popup';
        if (pageLabels.length && pageReference) {
            subjects = pageLabels.slice(0, 2).map(x => x.name);
            topicSource = 'page';
        }
        else if (!(pageReference && pageUrl))
            for (const prior of (options.history ?? []).slice(-4).reverse()) {
                subjects = matchingLabels(prior, known);
                if (subjects.length) {
                    topicSource = 'visitor_history';
                    break;
                }
            }
        if (!subjects.length && pageLabels.length) {
            subjects = pageLabels.slice(0, 2).map(x => x.name);
            topicSource = 'page';
        }
    }
    const searchQuery = subjects.length && topicSource !== 'explicit' ? `${query.slice(0, 800)}\nVisitor topic: ${subjects.join('; ')}` : query.slice(0, 1200);
    return { originalQuery: query, searchQuery, needs, subjects, pageUrl, topicSource, ambiguous: reference && !subjects.length };
}
/** Resolve only an implicit topic. This changes the safety question, not facts;
 * the full visitor message remains in the prompt/history and diagnostics. */
export function answerQuery(query: string, diagnostics?: RetrievalDiagnostics): string {
    if (!diagnostics || diagnostics.topicSource === 'explicit' || diagnostics.subjects.length !== 1)
        return query;
    const subject = diagnostics.subjects[0], needs = diagnostics.coverage.map(row => row.need);
    if (needs.length > 1)
        return query;
    if (needs[0] === 'price')
        return `${subject} price?`;
    if (needs[0] === 'refund')
        return `${subject} refund policy?`;
    if (needs[0] === 'cancellation')
        return `${subject} cancellation policy?`;
    if (needs[0] === 'hours')
        return 'Opening hours?';
    if (needs[0] === 'booking')
        return 'Is online booking available?';
    if (needs[0] === 'service')
        return `Is ${subject} available?`;
    return subject;
}
