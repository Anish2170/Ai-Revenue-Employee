export type CrawlState = 'fetched' | 'duplicate' | 'excluded' | 'failed' | 'gone' | 'pending';
export interface CrawlEntry {
    url: string;
    finalUrl?: string;
    depth: number;
    category: string;
    state: CrawlState;
    reason?: string;
    httpStatus?: number;
    renderer?: 'static' | 'js-rendered';
    canonical?: string;
    contentHash?: string;
    title?: string;
    chunkCount?: number;
}
export interface CrawlManifest {
    version: 1;
    scope: string;
    startedAt: string;
    finishedAt: string;
    maxPages: number;
    maxRenderedPages?: number;
    maxDepth: number;
    maxRequests: number;
    networkRequests: number;
    discovered: number;
    attempted: number;
    fetched: number;
    useful: number;
    rendered: number;
    duplicates: number;
    failed: number;
    skipped: number;
    completeWithinScope: boolean;
    limits: string[];
    entries: CrawlEntry[];
    categoriesFetched: string[];
    discoveredCategoriesNotFetched: string[];
}
