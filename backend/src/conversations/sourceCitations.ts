/** Additive citations in the existing sourceMetadata JSON; legacy fields remain. */
export interface SourceCitation {
    title: string;
    url: string;
}
export function sourceCitations(metadata: unknown, fallback?: SourceCitation | null): SourceCitation[] {
    const raw = metadata && typeof metadata === 'object' ? (metadata as {
        citations?: unknown;
    }).citations : undefined;
    const values = Array.isArray(raw) ? raw : [];
    const result: SourceCitation[] = [];
    for (const item of [...values, ...(fallback ? [fallback] : [])]) {
        if (!item || typeof item !== 'object' || typeof item.title !== 'string' || typeof item.url !== 'string' || !item.title.trim() || item.title.length > 200 || item.url.length > 2048)
            continue;
        try {
            const url = new URL(item.url);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || result.some(c => c.url === url.href))
                continue;
            result.push({ title: item.title, url: url.href });
        }
        catch { }
        if (result.length === 5)
            break;
    }
    return result;
}
