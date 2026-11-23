import type { StrategyKnowledgeResult } from '../intelligence/knowledgeRetrieval.js';
import { sanitizeText } from '../logging/sanitize.js';

function sourceId(id: string): string {
  return sanitizeText(id.replace(/\?[^#]*/, '')).slice(0, 180);
}

/** Record the filters and selected source references without copying source text. */
export function replayKnowledgeTrace(knowledge: StrategyKnowledgeResult, page?: string) {
  const diagnostics = knowledge.diagnostics;
  // The popup query can include values from the page URL. Record the exact
  // query for plain pages and withhold it when URL parameters were present.
  const queryContainsPageParameters = page?.includes('?') ?? false;
  const omitted = diagnostics?.omitted ?? [];
  const omissionReasons = [...new Set(omitted.map(row => row.reason))].map(reason => {
    const rows = omitted.filter(row => row.reason === reason);
    return { reason, count: rows.length, examples: rows.slice(0, 4).map(row => sourceId(row.id)) };
  });

  return {
    query: queryContainsPageParameters ? null : sanitizeText(knowledge.query).slice(0, 600),
    searchQuery: queryContainsPageParameters ? null : diagnostics?.searchQuery && sanitizeText(diagnostics.searchQuery).slice(0, 600),
    queryWithheld: queryContainsPageParameters,
    page: page ? sourceId(page).split('#')[0] : undefined,
    unavailableReason: knowledge.unavailableReason,
    retrievalMode: diagnostics?.mode,
    retrievalFailure: diagnostics?.failure,
    candidateCount: diagnostics?.candidateCount ?? 0,
    coverage: diagnostics?.coverage.map(({ need, status }) => ({ need, status })),
    selectedBySearch: diagnostics?.ranking.slice(0, 10).map(({ id, cosine, reasons }) => ({ id: sourceId(id), cosine, reasons })),
    keptForPopup: knowledge.chunks.map(({ id, score, content }) => ({ id: sourceId(id), score, characters: content.length })),
    conflicts: diagnostics?.conflicts.slice(0, 5).map(({ kind, sourceIds }) => ({ kind, sourceIds: sourceIds.slice(0, 6).map(sourceId) })),
    omissionReasons,
  };
}
