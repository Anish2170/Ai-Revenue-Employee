/** Action-only maintenance. Never calls ingestion, rendering or embeddings. */
import { createHash, randomUUID } from 'node:crypto';
import * as cheerio from 'cheerio';
import { z } from 'zod';
import { buildActionGraph, extractActionsFromHtml, type RawDiscoveredAction } from './actionDiscovery.js';
import type { DiscoveredActionGraph } from './discovered-action.types.js';
import type { KnowledgeSnapshot } from '../context/types.js';
import { normalizeUrl, isCrawlablePath, classifyPage } from '../crawler/links.js';
import { extract } from '../crawler/extract.js';
import { parseRobots } from '../crawler/robots.js';
import { parseAndValidateUrl, safeFetch, type SafeFetchOptions } from '../security/ssrf.js';
import { scopeDigest } from '../knowledge/crawlScope.js';

export const identitySchema = z.object({ organizationId: z.string().uuid(), websiteId: z.string().uuid(), userId: z.string().uuid() }).strict();
export type RefreshIdentity = z.infer<typeof identitySchema>;
export const refreshOptionsSchema = z.object({
  maxPages: z.number().int().min(1).max(100).default(50),
  maxRequests: z.number().int().min(1).max(300).default(200),
  maxTotalBytes: z.number().int().min(1024).max(32 * 1024 * 1024).default(20 * 1024 * 1024),
  timeoutMs: z.number().int().min(100).max(15000).default(10000),
  totalTimeoutMs: z.number().int().min(100).max(180000).default(120000),
}).strict();
export type RefreshOptions = z.infer<typeof refreshOptionsSchema>;
export interface RefreshSnapshotRow {
  id: string; organizationId: string; websiteId: string; storageProvider: 'LOCAL' | 'R2'; storageKey: string;
  contentSha256: string; contentBytes: number; sourceUrl: string; embeddingModel: string; dimensions: number;
  pagesCrawled: number; chunkCount: number; createdAt: string;
}
export interface RefreshOverride { id: string; intent: string; url: string; updatedAt: string }
export interface RefreshState {
  identity: RefreshIdentity; website: { url: string; revision: string }; row: RefreshSnapshotRow;
  snapshot: KnowledgeSnapshot; latestBuild: unknown; overrides: RefreshOverride[];
}
export interface RefreshReceipt { snapshotId: string; previousSnapshotId: string; contentSha256: string; operation: 'refresh' | 'rollback'; cachesRefreshed: boolean }
export interface RefreshRepository {
  load(identity: RefreshIdentity): Promise<RefreshState>;
  readParent(state: RefreshState, snapshotId: string): Promise<KnowledgeSnapshot>;
  publish(state: RefreshState, snapshot: KnowledgeSnapshot, operation: 'refresh' | 'rollback', reviewDigest: string, expiresAt: string): Promise<RefreshReceipt>;
}
export class ActionRefreshError extends Error {
  constructor(public code: string, message = code) { super(message); this.name = 'ActionRefreshError'; }
}
export function preservedKnowledgeDigest(snapshot: KnowledgeSnapshot): string {
  const { actionGraph: _graph, publication: _publication, actionRefresh: _refresh, ...knowledge } = snapshot;
  return scopeDigest(knowledge);
}
export function refreshFence(state: RefreshState): string {
  return scopeDigest({ identity: state.identity, website: state.website, row: state.row, latestBuild: state.latestBuild, overrides: state.overrides });
}
export function graphDigest(graph?: DiscoveredActionGraph): string {
  return scopeDigest(graph ? { ...graph, generatedAt: undefined } : null);
}
function groups(graph?: DiscoveredActionGraph) {
  return (graph?.nodes ?? []).map(node => ({ intent: node.intent, label: node.preferred.label, preferredUrl: node.preferred.url,
    destinations: [...new Set(node.candidates.map(c => c.url))].sort() })).sort((a, b) => a.intent.localeCompare(b.intent));
}
type PageOutcome = { url: string; kind: 'robots' | 'page'; state: 'fetched' | 'failed' | 'excluded'; reason?: string; status?: number; sha256?: string };
function overrideImpact(overrides: RefreshOverride[], graph?: DiscoveredActionGraph) {
  return overrides.map(override => ({ ...override, result: graph?.nodes.find(n => n.intent === override.intent)?.candidates.some(c => c.url === override.url)
    ? 'preserved' as const : 'would_be_invalid' as const }));
}
export interface RefreshPlan {
  version: 1; operation: 'refresh' | 'rollback'; identity: RefreshIdentity; generatedAt: string; expiresAt: string;
  snapshotId: string; fence: string; options: RefreshOptions; before: ReturnType<typeof groups>; after: ReturnType<typeof groups>;
  differences: Array<{ intent: string; before: ReturnType<typeof groups>[number] | null; after: ReturnType<typeof groups>[number] | null }>;
  overrides: ReturnType<typeof overrideImpact>; pages: PageOutcome[]; blockers: string[];
  graphDigest: string; knowledgeDigest: string; networkRequests: number; bytesRead: number; reviewDigest: string;
}
function reviewDigest(plan: RefreshPlan): string {
  return scopeDigest({ ...plan, reviewDigest: undefined });
}
function rediscoveryDigest(plan: RefreshPlan): string {
  return scopeDigest({ ...plan, generatedAt: undefined, expiresAt: undefined, reviewDigest: undefined });
}
type Transport = (url: string, options: SafeFetchOptions) => ReturnType<typeof safeFetch>;
export interface RefreshDependencies {
  repository: RefreshRepository; fetch?: Transport; now?: () => number; uuid?: () => string;
  sleep?: (ms: number) => Promise<void>;
}
export function createActionRefresh(deps: RefreshDependencies) {
  const now = deps.now ?? Date.now;
  const transport = deps.fetch ?? safeFetch;
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));

  async function discover(state: RefreshState, options: RefreshOptions) {
    const pages: PageOutcome[] = [], actions: RawDiscoveredAction[] = [];
    const origin = parseAndValidateUrl(state.website.url).origin;
    const inventory = new Map<string, KnowledgeSnapshot['pages'][number]>();
    const approval = state.snapshot.scopeApproval;
    const permitted = (raw: string) => {
      const url = normalizeUrl(raw);
      return Boolean(url && parseAndValidateUrl(url).origin === origin && isCrawlablePath(url)
        && (!approval || approval.inventory.some(e => normalizeUrl(e.url) === url && e.disposition === 'required')));
    };
    for (const page of state.snapshot.pages) {
      try {
        const url = normalizeUrl(page.url);
        if (!url || !permitted(url)) throw Error('inventory_not_permitted');
        inventory.set(url, page);
      } catch { pages.push({ url: page.url, kind: 'page', state: 'excluded', reason: 'inventory_not_permitted' }); }
    }
    let requests = 0, bytesRead = 0, lastRequest = 0;
    const robotsUrl = origin + '/robots.txt', started = now();
    const signal = AbortSignal.timeout(options.totalTimeoutMs);
    let policy = parseRobots('', origin);
    async function request(url: string, robots = false) {
      const remaining = () => options.totalTimeoutMs - (now() - started);
      if (remaining() <= 0 || signal.aborted) throw Error('time_budget');
      if (bytesRead >= options.maxTotalBytes) throw Error('byte_budget');
      const response = await transport(url, { timeoutMs: Math.max(1, Math.min(options.timeoutMs, remaining())),
        maxBytes: Math.min(robots ? 512000 : 2 * 1024 * 1024, options.maxTotalBytes - bytesRead), allowedOrigin: origin, signal,
        headers: { 'User-Agent': 'AIRevenueEmployee-Crawler/1.0', Accept: robots ? 'text/plain' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
        onRequest: async target => {
          const normalized = normalizeUrl(target.href);
          if (target.origin !== origin || !normalized || (robots ? normalized !== robotsUrl : !inventory.has(normalized) || !permitted(normalized) || !policy.allows(normalized))) throw Error('redirect_not_permitted');
          if (requests >= options.maxRequests) throw Error('request_budget');
          requests++;
          const delay = policy.delayMs ? Math.max(0, policy.delayMs - (now() - lastRequest)) : 0;
          if (delay >= remaining()) throw Error('time_budget');
          if (delay) await sleep(delay);
          signal.throwIfAborted(); lastRequest = now();
        },
      });
      bytesRead += response.body.length;
      if (bytesRead > options.maxTotalBytes) throw Error('byte_budget');
      const final = normalizeUrl(response.url);
      if (!final || new URL(final).origin !== origin || (robots ? final !== robotsUrl : !inventory.has(final) || !permitted(final) || !policy.allows(final))) throw Error('redirect_not_permitted');
      return response;
    }
    try {
      const response = await request(robotsUrl, true);
      if (response.status === 200) policy = parseRobots(response.body.toString('utf8'), origin);
      else if (![404, 410].includes(response.status)) throw Error('robots_unavailable');
      pages.push({ url: robotsUrl, kind: 'robots', state: 'fetched', status: response.status, sha256: createHash('sha256').update(response.body).digest('hex') });
    } catch {
      pages.push({ url: robotsUrl, kind: 'robots', state: 'failed', reason: 'robots_unavailable' });
      return { pages, graph: await buildActionGraph([], { rulesOnly: true }), networkRequests: requests, bytesRead };
    }
    let attempted = 0;
    for (const [url, page] of inventory) {
      try {
        if (++attempted > options.maxPages) throw Error('page_budget');
        if (!policy.allows(url)) throw Error('robots_disallow');
        const response = await request(url);
        if (response.status < 200 || response.status >= 300) throw Error(`http_${response.status}`);
        if (!/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(String(response.headers['content-type'] ?? ''))) throw Error('not_html');
        const html = response.body.toString('utf8'), $ = cheerio.load(html);
        if (/noindex|nofollow|none/i.test(String(response.headers['x-robots-tag'] ?? '') + ' ' + $('meta[name="robots" i]').attr('content'))) throw Error('page_restricted');
        if ($('a[href],button,[role="button"],input[type="submit"],input[type="button"],form').length > 1000) throw Error('control_budget');
        const extracted = extract(html, response.url);
        if (extracted.needsRendering) throw Error('rendering_required');
        const path = new URL(response.url).pathname;
        actions.push(...extractActionsFromHtml(html, { ...page, url: response.url, path, pageType: classifyPage(path), title: extracted.title, text: extracted.text }, 1000));
        if (actions.length > 10000) throw Error('action_budget');
        pages.push({ url, kind: 'page', state: 'fetched', status: response.status, sha256: createHash('sha256').update(response.body).digest('hex') });
      } catch (error) {
        const reason = error instanceof Error && /^(?:page_budget|robots_disallow|time_budget|byte_budget|request_budget|not_html|page_restricted|control_budget|rendering_required|action_budget|redirect_not_permitted|http_\d{3})$/.test(error.message) ? error.message : 'fetch_failed';
        pages.push({ url, kind: 'page', state: 'failed', reason });
      }
    }
    return { pages, graph: await buildActionGraph(actions.slice(0, 10000), { rulesOnly: true }), networkRequests: requests, bytesRead };
  }

  async function prepare(identity: RefreshIdentity, operation: 'refresh' | 'rollback', rawOptions: Partial<RefreshOptions> = {}) {
    identitySchema.parse(identity);
    const options = refreshOptionsSchema.parse(rawOptions), state = await deps.repository.load(identity);
    let graph: DiscoveredActionGraph | undefined, pages: PageOutcome[] = [], networkRequests = 0, bytesRead = 0;
    if (operation === 'refresh') {
      const discovery = await discover(state, options);
      ({ graph, pages, networkRequests, bytesRead } = discovery);
    } else {
      const parentId = state.snapshot.actionRefresh?.parentSnapshotId;
      if (!parentId) throw new ActionRefreshError('NO_REFRESH_TO_ROLL_BACK');
      const parent = await deps.repository.readParent(state, parentId);
      if (preservedKnowledgeDigest(parent) !== preservedKnowledgeDigest(state.snapshot)) throw new ActionRefreshError('ROLLBACK_KNOWLEDGE_MISMATCH');
      graph = parent.actionGraph;
    }
    const before = groups(state.snapshot.actionGraph), after = groups(graph), impacts = overrideImpact(state.overrides, graph);
    const blockers: string[] = [];
    if (operation === 'refresh' && (!state.snapshot.pages.length || !pages.some(p => p.kind === 'page' && p.state === 'fetched'))) blockers.push('no_pages_fetched');
    if (pages.some(p => p.state !== 'fetched')) blockers.push('incomplete_page_fetch');
    if (operation === 'refresh' && before.length && !after.length) blockers.push('empty_replacement_graph');
    if (impacts.some(row => row.result === 'would_be_invalid')) blockers.push('owner_override_not_rediscovered');
    const intents = [...new Set([...before, ...after].map(g => g.intent))].sort();
    const differences = intents.flatMap(intent => {
      const old = before.find(g => g.intent === intent) ?? null, next = after.find(g => g.intent === intent) ?? null;
      return scopeDigest(old) === scopeDigest(next) ? [] : [{ intent, before: old, after: next }];
    });
    const report: RefreshPlan = { version: 1, operation, identity, generatedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 3600000).toISOString(),
      snapshotId: state.row.id, fence: refreshFence(state), options, before, after, differences, overrides: impacts, pages, blockers,
      graphDigest: graphDigest(graph), knowledgeDigest: preservedKnowledgeDigest(state.snapshot), networkRequests, bytesRead, reviewDigest: '' };
    report.reviewDigest = reviewDigest(report);
    // Long dry-runs must not claim readiness against a snapshot changed mid-fetch.
    if (refreshFence(await deps.repository.load(identity)) !== report.fence) throw new ActionRefreshError('STALE_REFRESH_PLAN');
    return { report, graph, state };
  }
  return {
    async dryRun(identity: RefreshIdentity, operation: 'refresh' | 'rollback' = 'refresh', options: Partial<RefreshOptions> = {}): Promise<RefreshPlan> {
      return (await prepare(identity, operation, options)).report;
    },
    async apply(plan: RefreshPlan, expectedReviewDigest: string): Promise<RefreshReceipt> {
      if (plan.version !== 1 || !['refresh', 'rollback'].includes(plan.operation) || plan.reviewDigest !== expectedReviewDigest || reviewDigest(plan) !== expectedReviewDigest) throw new ActionRefreshError('INVALID_REVIEW_DIGEST');
      const generated = Date.parse(plan.generatedAt), expires = Date.parse(plan.expiresAt);
      if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > now() + 5000 || expires > generated + 3600000 || expires <= now()) throw new ActionRefreshError('EXPIRED_REFRESH_PLAN');
      if (plan.blockers.length) throw new ActionRefreshError('REFRESH_BLOCKED', plan.blockers.join(', '));
      // Check stale state before making even a public page request.
      if (refreshFence(await deps.repository.load(identitySchema.parse(plan.identity))) !== plan.fence) throw new ActionRefreshError('STALE_REFRESH_PLAN');
      const prepared = await prepare(plan.identity, plan.operation, plan.options);
      if (prepared.report.blockers.length || rediscoveryDigest(prepared.report) !== rediscoveryDigest(plan)) throw new ActionRefreshError('REDISCOVERY_CHANGED');
      if (expires <= now()) throw new ActionRefreshError('EXPIRED_REFRESH_PLAN');
      const snapshot = structuredClone(prepared.state.snapshot), id = (deps.uuid ?? randomUUID)();
      snapshot.actionGraph = prepared.graph;
      snapshot.publication = snapshot.publication ? { ...snapshot.publication, id } : { id, completedAt: snapshot.createdAt,
        completeness: snapshot.scopeApproval ? 'partial' : 'complete', changed: 0, unchanged: snapshot.documents.length, removed: 0, embeddingsReused: snapshot.documents.length };
      snapshot.actionRefresh = { version: 1, operation: plan.operation, parentSnapshotId: plan.snapshotId, appliedAt: new Date(now()).toISOString(), reviewDigest: expectedReviewDigest };
      if (preservedKnowledgeDigest(snapshot) !== plan.knowledgeDigest) throw new ActionRefreshError('KNOWLEDGE_CHANGED');
      return deps.repository.publish(prepared.state, snapshot, plan.operation, expectedReviewDigest, plan.expiresAt);
    },
  };
}
