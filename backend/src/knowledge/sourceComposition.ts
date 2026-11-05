import type { EmbeddedChunk } from '../context/types.js';
import { normalizeUrl } from '../crawler/links.js';

export interface SourceVersion {
  id: string; origin: string; kind: string; url: string | null; enabled: boolean;
  priority: number; deletedAt: Date | null; chunks: unknown; embeddingModel: string;
  checkedAt?: Date | null;
}

/** A later full crawl supersedes an older page refresh, retaining its policy. */
export function sourceVersionIsCurrent(source: SourceVersion, base: EmbeddedChunk[], model: string): boolean {
  if (source.embeddingModel !== model || !Array.isArray(source.chunks) || !source.chunks.length) return false;
  if (source.kind !== 'PAGE' || !source.url) return true;
  const crawledAt = Math.max(0, ...base.filter(doc => normalizeUrl(doc.url) === normalizeUrl(source.url!) || doc.sourceAliases?.some(alias => normalizeUrl(alias.url) === normalizeUrl(source.url!)))
    .map(doc => Date.parse(doc.lastCrawled) || 0));
  return (source.checkedAt?.getTime() ?? Infinity) >= crawledAt;
}

/** Apply exclusions before retrieval, including deduplicated source aliases.
 * A queued/failed replacement retains its last published version. */
export function composeSourceDocuments(base: EmbeddedChunk[], sources: SourceVersion[], origin: string, model: string): EmbeddedChunk[] {
  const scoped = sources.filter(source => source.origin === origin);
  const policies = new Map(scoped.filter(source => source.url).map(source => [normalizeUrl(source.url!), source]));
  const current = new Set(scoped.filter(source => sourceVersionIsCurrent(source, base, model)).map(source => source.id));
  const hidden = (url: string) => {
    const policy = policies.get(normalizeUrl(url));
    return Boolean(policy && (!policy.enabled || policy.deletedAt || current.has(policy.id)));
  };
  const result: EmbeddedChunk[] = [];
  for (const doc of base) {
    const aliases = doc.sourceAliases?.filter(alias => !hidden(alias.url));
    const primary = !hidden(doc.url) ? doc : aliases?.length ? {
      ...doc, url: aliases[0].url, title: aliases[0].title, heading: aliases[0].heading,
      page: new URL(aliases[0].url).pathname, id: `${doc.id}:alias:${aliases[0].url}`,
    } : null;
    if (!primary) continue;
    const policy = policies.get(normalizeUrl(primary.url));
    result.push({ ...primary, sourceAliases: aliases, knowledgeSourceId: policy?.id, sourcePriority: policy?.priority ?? 0, sourceKind: 'PAGE' });
  }
  for (const source of scoped) {
    if (!source.enabled || source.deletedAt || !current.has(source.id) || !Array.isArray(source.chunks)) continue;
    for (const chunk of source.chunks as EmbeddedChunk[]) {
      // Stored data is server generated. Validate vectors again at read time.
      if (!chunk.id || !chunk.content || !Array.isArray(chunk.embedding) || !chunk.embedding.length || chunk.embedding.some(n => !Number.isFinite(n))) continue;
      result.push({ ...chunk, knowledgeSourceId: source.id, sourcePriority: source.priority, sourceKind: source.kind as 'PAGE' | 'TEXT' | 'FILE' });
    }
  }
  return result;
}
