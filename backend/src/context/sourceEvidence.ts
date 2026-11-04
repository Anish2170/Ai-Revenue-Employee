/** Source excerpts for ordinary website prose that has no typed price/policy
 * grammar. Relevance chooses a complete unit; it never rewrites its claims. */
import type { RetrievedChunk } from './types.js';
import { normalizeFactQuery } from './factQuery.js';
import { sourceUnsafe, subjectTerms } from './sourceRecords.js';

const filler = new Set('who long required require advance included include inclusion get receive provide custom my can i membership member gym fitness policy request opening what how our us there at daily'.split(' '));
function terms(text: string): string[] {
  const normalized = normalizeFactQuery(text)
    .replace(/\b(?:cancellations?|cancelling|cancelled)\b/gu, 'cancel')
    .replace(/\b(?:freezing|frozen)\b/gu, 'freeze')
    .replace(/\b(?:timings?|times?)\b/gu, 'hours')
    .replace(/\b(?:locations?|located|addresses|address|where)\b/gu, 'location')
    .replace(/\b(?:bookings?)\b/gu, 'booking')
    .replace(/\b(?:sessions?)\b/gu, 'session');
  return [...new Set(subjectTerms(normalized).filter(t => !filler.has(t)))];
}
export interface SourceUnit { content: string; label: string }
export function sourceUnits(chunk: RetrievedChunk): SourceUnit[] {
  if (sourceUnsafe.test(chunk.content) || ('truncated' in chunk && chunk.truncated)) return [];
  const blocks = chunk.content.split(/\n\s*\n/u).map(b => b.trim()).filter(Boolean);
  const questions = blocks.some(b => b.endsWith('?') && b.length < 240);
  if (questions) {
    const result: SourceUnit[] = [];
    for (let i = 0; i < blocks.length; i++) {
      if (!blocks[i].endsWith('?') || blocks[i].length >= 240) continue;
      const label = blocks[i], answers: string[] = [];
      while (i + 1 < blocks.length && !blocks[i + 1].endsWith('?')) answers.push(blocks[++i]);
      const content = answers.join('\n\n');
      if (content && content.length <= 2400) result.push({ label, content });
    }
    return result;
  }
  // Retain the whole section, including prices, exceptions and adjacent notes.
  return chunk.content.trim().length <= 900 && !chunk.content.trim().endsWith('?') && !/conditions apply\.?$/iu.test(chunk.content.trim())
    ? [{ label: chunk.heading, content: chunk.content.trim() }] : [];
}
export function sourceEvidenceMatches(chunk: RetrievedChunk, query: string): Array<SourceUnit & { relevance: number }> {
  const q = terms(query);
  if (!q.length) return [];
  const location = /\b(?:where|address|located|location)\b/iu.test(query);
  const identity = /^who\b/iu.test(query);
  const schedule = /\b(?:schedule|when|timing)\b/iu.test(query);
  const hours = /\b(?:hours?|open|closed)\b/iu.test(query);
  const catalog = /^(?:pricing|membership|memberships)[.!?]*$/iu.test(normalizeFactQuery(query).trim());
  if (catalog || /\b(?:price|pricing|cost|how much|fee)\b/iu.test(normalizeFactQuery(query))) return [];
  let path = chunk.page;
  try { path = decodeURIComponent(path); } catch { /* Retain a literal malformed escape as source data. */ }
  return sourceUnits(chunk).flatMap(unit => {
    const local = terms(unit.label + ' ' + unit.content);
    const metadata = terms(chunk.heading + ' ' + path.replace(/[-_/]/gu, ' '));
    const matched = q.filter(t => local.includes(t) || metadata.includes(t));
    // Concrete visitor terms must be present. Metadata can identify the entity,
    // but the requested facet must exist in the actual source unit.
    if (matched.length !== q.length) return [];
    if (/public contact and hours/iu.test(chunk.heading) && !/\b(?:am|pm|hours?|closed|monday|sunday)\b|\d\s*\/\s*7/iu.test(unit.content)) return [];
    if (hours && !/\b(?:am|pm|hours?|closed|monday|sunday)\b|\d\s*\/\s*7/iu.test(unit.content)) return [];
    if (location && !/\d.{0,80}(?:street|road|avenue|ave|blvd|district|suite|\bNY\b|\b[A-Z]{2}\s+\d{5})|address|located/iu.test(unit.content)) return [];
    if (identity && !/\b(?:about|bio|coach|team|trainer|founder|profile)\b/iu.test(chunk.heading + ' ' + chunk.page)) return [];
    if (schedule && !/\b(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|am|pm)\b/iu.test(unit.content)) return [];
    if (!/[.!?।\d]/u.test(unit.content) || unit.content.length < 20) return [];
    return [{ ...unit, relevance: q.length + terms(unit.label).filter(t => q.includes(t)).length * 2
      + (location && /locations?/iu.test(chunk.page) ? 3 : 0) + (identity && /about|bio/iu.test(chunk.heading) ? 3 : 0)
      + (/\bopening\b/iu.test(query) && /\bopening\b/iu.test(unit.label) ? 2 : 0)
      + (schedule && /schedule/iu.test(unit.label) ? 4 : 0) }];
  });
}
