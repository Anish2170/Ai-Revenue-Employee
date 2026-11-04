/** BM25 relevance over already tenant-scoped source text. No provider call. */
import { normalizedTerms, topicTerms } from './retrievalPlan.js';
import { normalizeFactQuery } from './factQuery.js';
import type { RetrievedChunk } from './types.js';
export function lexicalRanking(chunks: RetrievedChunk[], query: string): Map<string, number> {
  const clean = normalizeFactQuery(query), specific = topicTerms(clean);
  const terms = specific.length ? specific : normalizedTerms(clean);
  const rows = chunks.map(chunk => ({ chunk, tokens: (`${chunk.heading} ${chunk.heading} ${chunk.page} ${chunk.content}`.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).flatMap(word => normalizedTerms(word)) }));
  const avg = rows.reduce((n, r) => n + r.tokens.length, 0) / (rows.length || 1), scores = new Map<string, number>();
  const frequency = new Map(terms.map(term => [term, rows.filter(r => r.tokens.includes(term)).length]));
  for (const row of rows) {
    let score = 0;
    for (const term of terms) {
      const tf = row.tokens.filter(t => t === term).length;
      if (!tf) continue;
      const df = frequency.get(term)!;
      score += Math.log(1 + (rows.length - df + .5) / (df + .5)) * tf * 2.2 / (tf + 1.2 * (.25 + .75 * row.tokens.length / (avg || 1)));
    }
    scores.set(row.chunk.id, score);
  }
  return scores;
}
