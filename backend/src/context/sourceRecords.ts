/** Source-bound structural records. No model output or owner instructions enter here.
 * Legacy flat cards are supported without rewriting the published snapshot. */
import type { RetrievedChunk } from './types.js';
export const sourceUnsafe = /ignore|system prompt|instruction|pretend|hypothetical|for example|used to|previously|expired|outdated|historical|<script|override/iu;
export const moneyPattern = String.raw`(?:[$₹€£¥]\s*\d[\d,]*(?:\.\d+)?|(?:USD|INR|EUR|GBP|CAD|AUD)\s*\d[\d,]*(?:\.\d+)?)`;
const amountPattern = `${moneyPattern}(?:\\s*[-–—]\\s*(?:${moneyPattern}|\\d[\\d,]*(?:\\.\\d+)?))?`;
const amountLine = new RegExp(`^(?:Price|Cost|Fee)?\\s*:?\\s*(${amountPattern})((?:\\s*\\/(?:mo|month|yr|year|night|visit|session|item|tooth))?)$`, 'iu');
export interface PriceRecord { subject: string; amount: string; qualification: string; text: string; raw: string; chunk: RetrievedChunk }
export function priceRecords(chunk: RetrievedChunk): PriceRecord[] {
  if (sourceUnsafe.test(chunk.content) || ('truncated' in chunk && chunk.truncated)) return [];
  const records: PriceRecord[] = [];
  const blocks = chunk.content.split(/\n\s*\n/u);
  const scopeNotes = blocks.filter(block => /^(?:all (?:prices|fees)|prices? (?:exclude|include|subject)|fees? (?:exclude|include)|conditions apply|only .{0,80}qualify|subject to|billed (?:annually|monthly)|excluding (?:tax|VAT)|including (?:tax|VAT))/iu.test(block.trim()));
  for (const block of blocks) {
    // DOM table rows retain cell boundaries. Flat legacy cards retain line boundaries.
    for (const unit of block.includes(' | ') ? block.split('\n') : [block]) {
      const lines = unit.replace(/(?<=[a-z)])(?=[A-Z][a-z])/gu, '\n').split(/\n|\s+\|\s+/u).map(s => s.trim()).filter(Boolean);
      const indexes = lines.map((s, i) => amountLine.test(s) ? i : -1).filter(i => i >= 0);
      if (indexes.length !== 1 || lines.length > 8 || unit.length > 700) continue;
      const index = indexes[0], match = lines[index].match(amountLine)!;
      const subject = index === 0 ? chunk.heading : lines[0];
      // A value alone, CTA or generic heading does not identify a priced item.
      if (!subject || subject.length > 120 || /^(?:price|cost|fee|pricing|plans?|services?)$/iu.test(subject) || /[$₹€£¥]|sign up|book |https?:/iu.test(subject)) continue;
      const sectionNotes = index === 0 ? blocks.filter(b => b !== block && b.trim() !== subject && !amountLine.test(b.trim())) : [];
      if (sectionNotes.some(b => /[$₹€£¥]\s*\d/u.test(b))) continue;
      const qualification = [...new Set([match[2].trim(), ...lines.filter((_, i) => i !== index && !(index > 0 && i === 0)), ...scopeNotes, ...sectionNotes])].filter(Boolean).join('; ');
      const amount = match[1].replace(/\s*[-–—]\s*/u, '–');
      const text = `${subject} costs ${amount}.${qualification ? ` ${qualification.replace(/[.!?]$/u, '')}.` : ''}`;
      records.push({ subject, amount, qualification, text, raw: unit, chunk });
    }
  }
  return records;
}
const stop = new Set('a an the and or for to from of in on at per this that these those it its they their my your our you we me i how what which why when where does do is are can could would should please tell explain about more much want need know cost costs price pricing fee fees plan plans service services treatment treatments details detail information list all available offer provide offered provided kitna kitne kitni ka ki ke kya hai hain ho hota hoti aap aapki mein ko karne se shuru he rehta batao bata aur daam lagega hoga mujhe मुझे की का के क्या है हैं कितना कीमत रुपये कितने शुरू होती बताओ'.split(' '));
export function subjectTerms(text: string): string[] {
  return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .map(s => s.length > 4 && s.endsWith('s') ? s.slice(0, -1) : s).filter(s => !stop.has(s));
}
export function broadCatalogQuery(query: string): 'price' | 'service' | null {
  if (subjectTerms(query).length) return null;
  if (/\b(?:price|prices|pricing|fees)\b/iu.test(query)) return 'price';
  if (/\b(?:services|treatments)\b/iu.test(query)) return 'service';
  return null;
}
function closeWord(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/** Every concrete query term must match. Partial names may select several
 * variants; callers must keep ambiguity/conflicts rather than choose a price. */
export function matchesSubject(query: string, subject: string): boolean {
  const q = subjectTerms(query), s = subjectTerms(subject);
  return q.length > 0 && q.every(word => s.some(other => closeWord(word, other)));
}
