/** Bounded deterministic ranking/coverage. Cosine remains the public score;
 * rankScore explains relevance, never verifies factual truth. */
import { normalizeUrl } from '../crawler/links.js';
import { chunkNeeds, normalizedTerms, topicTerms, type EvidenceConflict, type QueryPlan, type RetrievalDiagnostics } from './retrievalPlan.js';
import type { RetrievedChunk } from './types.js';
import { priceRecords, matchesSubject, broadCatalogQuery, contactRecords, matchesContact, serviceDescriptions } from './sourceRecords.js';
import { availabilityRequest } from './factQuery.js';
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const tainted = (text: string) => /ignore (?:previous|all|the)|system prompt|override .*instructions|pretend (?:you|to)|<script/iu.test(text);
interface Material {
    kind: EvidenceConflict['kind'];
    subject: string;
    value: string;
}
function material(content: string): Material[] {
    const result: Material[] = [];
    for (const text of content.split(/\n+|(?<=[.!?])\s+(?=[\p{L}])/u)) {
        let match = text.trim().match(/^(.{1,100}?) (starts? at|costs?|is priced at) ([$₹€£¥]\s*\d[\d,.]*.*)\.$/iu);
        if (match) {
            result.push({ kind: 'price', subject: match[1], value: normalize(match[2] + ' ' + match[3]) });
            continue;
        }
        match = text.trim().match(/^(.{1,100}?) (?:is|are) (not offered|not provided|not available|offered|provided|available|non-refundable|refundable|not refundable)(.*?)\.$/iu);
        if (match)
            result.push({ kind: /refund|return/i.test(match[1] + ' ' + match[2]) ? 'refund' : 'service', subject: match[1], value: normalize(match[2] + match[3]) });
    }
    return result;
}
function conflicts(all: RetrievedChunk[], plan: QueryPlan): EvidenceConflict[] {
    const groups = new Map<string, Array<{
        fact: Material;
        chunk: RetrievedChunk;
    }>>();
    const subjectTokens = plan.subjects.flatMap(topicTerms), queryTokens = topicTerms(plan.originalQuery);
    for (const chunk of all) {
        if (tainted(chunk.content) || /\b(?:previously|historical|hypothetical|for example|outdated)\b/iu.test(chunk.content))
            continue;
        for (const fact of [...material(chunk.content), ...priceRecords(chunk).map(record => ({ kind: 'price' as const, subject: record.subject, value: normalize(record.amount + '|' + record.qualification) })),
          ...contactRecords(chunk).filter(record => matchesContact(plan.originalQuery, record)).map(record => ({ kind: 'contact' as const, subject: record.subject, value: record.value }))]) {
            const terms = topicTerms(fact.subject);
            const relevant = fact.kind === 'contact' || terms.length > 0 && (subjectTokens.length ? terms.every(t => subjectTokens.includes(t)) : terms.some(t => queryTokens.includes(t)) || !queryTokens.length && plan.needs.includes('price')) || fact.kind === 'refund' && plan.needs.includes('refund');
            if (!relevant || plan.needs.length && !plan.needs.includes(fact.kind) && !(fact.kind === 'service' && plan.needs.includes('booking')))
                continue;
            const key = fact.kind + ':' + terms.slice().sort().join(' '), rows = groups.get(key) ?? [];
            rows.push({ fact, chunk });
            groups.set(key, rows);
        }
    }
    return [...groups.values()].filter(rows => new Set(rows.map(r => r.fact.value)).size > 1).slice(0, 10).map(rows => ({ kind: rows[0].fact.kind, subject: rows[0].fact.subject, sourceIds: [...new Set(rows.map(r => r.chunk.id))].slice(0, 20), urls: [...new Set(rows.map(r => r.chunk.url))].slice(0, 20) }));
}
export function selectRetrieval(all: RetrievedChunk[], plan: QueryPlan, options: {
    topK: number;
    threshold: number;
    maxChars: number;
    sourceUrl?: string;
    activeVersion?: string;
}) {
    const omitted: RetrievalDiagnostics['omitted'] = [], duplicates: RetrievalDiagnostics['duplicates'] = [];
    let origin: string | undefined;
    try {
        if (options.sourceUrl)
            origin = new URL(options.sourceUrl).origin;
    }
    catch { }
    const scoped = all.filter(chunk => { let valid = true; try {
        valid = !origin || new URL(chunk.url, options.sourceUrl).origin === origin;
    }
    catch {
        valid = false;
    } if (!valid)
        omitted.push({ id: chunk.id, reason: 'source_origin_mismatch' }); return valid; });
    const conflictList = conflicts(scoped, plan), subjects = plan.subjects.map(topicTerms), queryTerms = topicTerms(plan.originalQuery);
    const duplicateMap = new Map<string, RetrievedChunk>();
    const unique: RetrievedChunk[] = [];
    for (const chunk of scoped) {
        if (tainted(chunk.content)) {
            omitted.push({ id: chunk.id, reason: 'source_instruction_text' });
            continue;
        }
        const records = priceRecords(chunk);
        const broad = Boolean(broadCatalogQuery(plan.originalQuery));
        const exactRecord = records.some(record => matchesSubject(plan.originalQuery, record.subject) || plan.subjects.some(subject => matchesSubject(subject, record.subject)));
        const contact = contactRecords(chunk).some(record => matchesContact(plan.originalQuery, record));
        const description = availabilityRequest(plan.originalQuery) && serviceDescriptions(chunk, plan.originalQuery).length > 0;
        // A source-bound lexical match can recover a weak semantic hit. It
        // changes relevance only; evidence and origin guards still run below.
        if (!Number.isFinite(chunk.score) || chunk.score < options.threshold && !exactRecord && !(broad && records.length) && !contact && !description) {
            omitted.push({ id: chunk.id, reason: 'below_cosine_threshold' });
            continue;
        }
        const statements = material(chunk.content), key = normalize((statements.length ? '' : chunk.heading + '\n') + chunk.content), prior = duplicateMap.get(key);
        if (prior) {
            let group = duplicates.find(g => g.keptId === prior.id);
            if (!group) {
                group = { keptId: prior.id, sourceIds: [prior.id] };
                duplicates.push(group);
            }
            group.sourceIds.push(chunk.id);
            (prior.sourceAliases ??= []).push({ url: chunk.url, title: chunk.title, heading: chunk.heading });
            continue;
        }
        const sourceAliases = chunk.sourceAliases?.filter(alias => { try {
            return !origin || new URL(alias.url).origin === origin;
        }
        catch {
            return false;
        } }).map(alias => ({ ...alias }));
        const copy = { ...chunk, sourceAliases };
        duplicateMap.set(key, copy);
        unique.push(copy);
    }
    const knownSubjects = unique.map(chunk => topicTerms(chunk.heading)).filter(terms => terms.length > 0);
    const candidates = unique.map(chunk => {
        const records = priceRecords(chunk);
        const metadata = normalizedTerms(chunk.heading + ' ' + chunk.title + ' ' + chunk.page), body = normalizedTerms(chunk.content), needs = chunkNeeds(chunk), reasons: string[] = [];
        const recordMatch = records.some(record => matchesSubject(plan.originalQuery, record.subject) || plan.subjects.some(subject => matchesSubject(subject, record.subject)));
        const contactMatch = contactRecords(chunk).some(record => matchesContact(plan.originalQuery, record));
        const descriptionMatch = availabilityRequest(plan.originalQuery) && serviceDescriptions(chunk, plan.originalQuery).length > 0;
        if (recordMatch || contactMatch || descriptionMatch) reasons.push('source_lexical_match');
        if (contactMatch) needs.push('contact');
        if (descriptionMatch) needs.push('service');
        if (plan.needs.includes('service') && records.length) needs.push('service');
        const contentSubjects = material(chunk.content).filter(f => f.kind === 'price').map(f => topicTerms(f.subject));
        const subjectMatches = subjects.map(terms => terms.length > 0 && terms.every(t => metadata.includes(t) || body.includes(t)));
        const bodyMismatch = subjects.length && contentSubjects.length && !contentSubjects.some(terms => subjects.some(subject => subject.every(t => terms.includes(t)) && !knownSubjects.some(other => other.length > subject.length && subject.every(t => other.includes(t)) && other.every(t => terms.includes(t)))));
        const entity = (recordMatch || contactMatch || descriptionMatch || subjectMatches.some(Boolean)) && !bodyMismatch;
        const lexical = queryTerms.length ? queryTerms.filter(t => body.includes(t) || metadata.includes(t)).length / queryTerms.length : 0;
        const facet = plan.needs.filter(n => needs.includes(n)).length;
        const exactPage = Boolean(plan.pageUrl && normalizeUrl(chunk.url) === plan.pageUrl && !/public contact|footer|navigation/iu.test(chunk.heading));
        let rankScore = chunk.score + lexical * .2 + (entity ? .3 : 0) + (facet ? Math.min(.12, .06 * facet) : 0);
        if (contactMatch && chunk.pageType === 'contact') rankScore += .2;
        if (broadCatalogQuery(plan.originalQuery) && records.length) {
            rankScore += .4;
            reasons.push('published_catalog_records');
        }
        if (entity)
            reasons.push('subject_match');
        if (lexical)
            reasons.push('lexical_overlap');
        if (facet)
            reasons.push('requested_need');
        if (exactPage && (entity || plan.topicSource === 'page')) {
            rankScore += .12;
            reasons.push('indexed_page_match');
        }
        if (bodyMismatch) {
            rankScore -= .6;
            reasons.push('source_subject_mismatch');
        }
        return { chunk, needs, rankScore, reasons, entity, bodyMismatch };
    }).sort((a, b) => b.rankScore - a.rankScore || a.chunk.id.localeCompare(b.chunk.id));
    const selected: typeof candidates = [], max = Math.min(10, Math.max(1, options.topK));
    let remaining = Math.max(0, Math.min(20000, options.maxChars));
    const add = (row: typeof candidates[number]) => {
        if (selected.includes(row) || selected.length >= max)
            return false;
        if (row.chunk.content.length > remaining) {
            if (!omitted.some(x => x.id === row.chunk.id && x.reason === 'whole_source_exceeds_budget'))
                omitted.push({ id: row.chunk.id, reason: 'whole_source_exceeds_budget' });
            return false;
        }
        selected.push(row);
        remaining -= row.chunk.content.length;
        return true;
    };
    for (const need of plan.needs) {
        if (selected.some(row => row.needs.includes(need)))
            continue;
        for (const row of candidates) {
            if (!row.needs.includes(need) || row.bodyMismatch)
                continue;
            if (subjects.length && !row.entity && !['refund', 'cancellation', 'hours', 'booking'].includes(need))
                continue;
            if (add(row))
                break;
        }
    }
    for (const row of candidates) {
        if (row.bodyMismatch)
            continue;
        if (plan.needs.length && !row.needs.some(need => plan.needs.includes(need)))
            continue;
        // A specific subject should not be displaced by unrelated material. Shared
        // policy/hours remain cross-page candidates when the question requests them.
        if (subjects.length && !row.entity && !row.needs.some(need => plan.needs.includes(need) && ['refund', 'cancellation', 'hours', 'booking'].includes(need)))
            continue;
        if (selected.filter(r => normalizeUrl(r.chunk.url) === normalizeUrl(row.chunk.url)).length >= 2)
            continue;
        add(row);
    }
    const diagnostics: RetrievalDiagnostics = { originalQuery: plan.originalQuery, searchQuery: plan.searchQuery, topicSource: plan.topicSource, subjects: plan.subjects, pageUrl: plan.pageUrl, ambiguous: plan.ambiguous, activeVersion: options.activeVersion, candidateCount: all.length, coverage: plan.needs.map(need => ({ need, status: selected.some(row => row.needs.includes(need)) ? 'candidate' : 'missing', sourceIds: selected.filter(row => row.needs.includes(need)).map(row => row.chunk.id) })), conflicts: conflictList, duplicates, ranking: selected.map(row => ({ id: row.chunk.id, cosine: row.chunk.score, rankScore: row.rankScore, reasons: row.reasons })), omitted: omitted.slice(0, 100) };
    return { chunks: selected.map(row => row.chunk), scores: selected.map(row => Number(row.chunk.score.toFixed(3))), diagnostics };
}
