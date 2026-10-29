/** Owner review defines source coverage, never factual authority. No network or DB access here. */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import { config } from '../config/index.js';
import { normalizeUrl, isCrawlablePath } from '../crawler/links.js';
import { parseAndValidateUrl, isPublicAddress } from '../security/ssrf.js';
import type { CrawlEntry, CrawlManifest } from '../crawler/crawlManifest.js';
import type { KnowledgeSnapshot } from '../context/types.js';

export const crawlBudgetSchema = z.object({
  maxPages: z.number().int().min(1).max(100),
  maxRenderedPages: z.number().int().min(0).max(8),
}).strict();
export type CrawlBudget = z.infer<typeof crawlBudgetSchema>;
export const defaultCrawlBudget = (): CrawlBudget => ({ maxPages: Math.min(100, Math.max(1, Math.floor(config.crawl.maxPages) || 25)), maxRenderedPages: 3 });
export class ScopeError extends Error {
  constructor(message: string, public status = 409) { super(message); this.name = 'ScopeError'; }
}
// JSONB may reorder object keys. Integrity must survive a database round trip.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const scopeDigest = digest;
export interface ScopeInventoryEntry {
  url: string;
  category: string;
  title?: string;
  disposition: 'required' | 'owner_excluded' | 'system_excluded';
  reason?: string;
}
export interface ScopeApproval {
  version: 1;
  organizationId: string;
  websiteId: string;
  configuredWebsiteUrl: string;
  configuredWebsiteRevision: string;
  sourceUrl: string;
  reviewedBuildId: string;
  reviewHash: string;
  approvedByUserId: string;
  approvedAt: string;
  expiresAt: string;
  reason: string;
  budget: CrawlBudget;
  inventory: ScopeInventoryEntry[];
  hash: string;
}
export interface BuildConfiguration { version: 1; budget: CrawlBudget; approval?: ScopeApproval }
export function readBuildConfiguration(value: unknown): BuildConfiguration | undefined {
  if (value == null) return undefined;
  const parsed = value as BuildConfiguration;
  if (parsed.version !== 1) throw new ScopeError('Unsupported crawl configuration.');
  crawlBudgetSchema.parse(parsed.budget);
  if (parsed.approval) {
    validateApprovalIdentity(parsed.approval);
    if (digest(parsed.budget) !== digest(parsed.approval.budget)) throw new ScopeError('Approved budget changed.');
  }
  return parsed;
}

/** Signals are conservative review guards, not proof that a URL contains authoritative facts. */
export function exclusionBlockReason(entry: CrawlEntry, previousUrls: string[], sourceUrl: string): string | null {
  if (entry.url === normalizeUrl(sourceUrl)) return 'Connected start page is required.';
  if (previousUrls.includes(entry.url) || entry.finalUrl && previousUrls.includes(entry.finalUrl)) return 'Previously published sources must be reverified.';
  if (entry.category !== 'blog') return 'Only ordinary blog/news pages are eligible for exclusion in this version.';
  if (/refund|return|cancel|polic|terms|pric|cost|plan|book|appointment|service|product|guarantee|warrant|payment|billing/i.test(`${entry.url} ${entry.title ?? ''}`)) return 'Potential business-critical information requires successful verification.';
  if (entry.reason && /unsafe|robots|scope|size|unverified/.test(entry.reason)) return 'Security/restriction failures cannot be approved away.';
  return null;
}
export interface ScopeReviewInput {
  organizationId: string; websiteId: string; configuredWebsiteUrl: string; configuredWebsiteRevision: string; sourceUrl: string;
  buildId: string; artifactSha256: string; previousUrls: string[]; activeVersion: string | null; manifest: CrawlManifest;
}
export function makeScopeReview(input: ScopeReviewInput) {
  const entries = [...input.manifest.entries].sort((a, b) => a.url.localeCompare(b.url));
  const hash = digest({ ...input, manifest: { ...input.manifest, entries } });
  return { hash, sourceUrl: input.sourceUrl, configuredWebsiteUrl: input.configuredWebsiteUrl,
    entries: entries.map(entry => ({ ...entry, exclusionBlockReason: exclusionBlockReason(entry, input.previousUrls, input.sourceUrl) })),
    budget: { maxPages: input.manifest.maxPages, maxRenderedPages: input.manifest.maxRenderedPages ?? 3 },
    limitations: 'All included useful HTML sources must succeed. Only reviewed ordinary blog/news exclusions are supported. Excluded pages supply no facts. New source URLs require a new review. This does not verify the entire website.' };
}
export function createScopeApproval(input: ScopeReviewInput, request: {
  reviewHash: string; excludedUrls: string[]; reason: string; acknowledgeLimitations: boolean; budget: CrawlBudget;
}, userId: string, now = Date.now()): ScopeApproval {
  if (request.reviewHash !== makeScopeReview(input).hash) throw new ScopeError('Review is stale. Reload the source inventory.');
  if (!request.acknowledgeLimitations || request.reason.trim().length < 12 || request.reason.length > 500 || !request.excludedUrls.length)
    throw new ScopeError('Explicit scope limitation acknowledgement and a reason are required.', 400);
  if (input.manifest.limits.some(limit => limit !== 'page_budget') || input.manifest.entries.some(entry => entry.reason === 'robots_disallow'))
    throw new ScopeError('Resolve crawl restrictions or discovery limits before approving exclusions.');
  const budget = crawlBudgetSchema.parse(request.budget);
  const excluded = new Set(request.excludedUrls);
  if (excluded.size !== request.excludedUrls.length) throw new ScopeError('Duplicate excluded URL.', 400);
  for (const url of excluded) {
    const entry = input.manifest.entries.find(entry => entry.url === url);
    if (!entry || exclusionBlockReason(entry, input.previousUrls, input.sourceUrl)) throw new ScopeError('Excluded source is unknown or protected.');
  }
  const inventory: ScopeInventoryEntry[] = input.manifest.entries.map<ScopeInventoryEntry>(entry => ({ url: entry.url, category: entry.category, ...(entry.title ? { title: entry.title } : {}),
    disposition: excluded.has(entry.url) ? 'owner_excluded' : entry.state === 'excluded' && entry.reason === 'outside_html_scope' && !input.previousUrls.includes(entry.url) ? 'system_excluded' : 'required',
    ...(excluded.has(entry.url) ? { reason: request.reason.trim() } : entry.reason ? { reason: entry.reason } : {}),
  })).sort((a, b) => a.url.localeCompare(b.url));
  if (inventory.filter(entry => entry.disposition === 'required').length > budget.maxPages) throw new ScopeError('Page budget is smaller than the required source set.');
  const unsigned = { version: 1 as const, organizationId: input.organizationId, websiteId: input.websiteId,
    configuredWebsiteUrl: input.configuredWebsiteUrl, configuredWebsiteRevision: input.configuredWebsiteRevision, sourceUrl: input.sourceUrl, reviewedBuildId: input.buildId, reviewHash: request.reviewHash,
    approvedByUserId: userId, approvedAt: new Date(now).toISOString(), expiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(), reason: request.reason.trim(), budget, inventory };
  const approval = { ...unsigned, hash: digest(unsigned) };
  validateApprovalIdentity(approval);
  return approval;
}
export function validateApprovalIdentity(approval: ScopeApproval): void {
  const { hash, ...unsigned } = approval;
  if (approval.version !== 1 || hash !== digest(unsigned) || !approval.configuredWebsiteRevision || !approval.approvedByUserId || !approval.organizationId || !approval.websiteId || !/^[a-f0-9]{64}$/.test(approval.reviewHash)) throw new ScopeError('Invalid scope approval integrity.');
  crawlBudgetSchema.parse(approval.budget);
  if (!Number.isFinite(Date.parse(approval.expiresAt)) || !Number.isFinite(Date.parse(approval.approvedAt))) throw new ScopeError('Invalid approval timestamps.');
  const origin = parseAndValidateUrl(approval.sourceUrl).origin;
  const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) throw new ScopeError('Private source origin rejected.');
  if (new URL(approval.configuredWebsiteUrl).origin !== origin || !Array.isArray(approval.inventory) || approval.inventory.length > 2000 || !approval.inventory.length) throw new ScopeError('Invalid approved source inventory.');
  const seen = new Set<string>();
  for (const entry of approval.inventory) {
    if (normalizeUrl(entry.url) !== entry.url || parseAndValidateUrl(entry.url).origin !== origin || seen.has(entry.url) || !['required', 'owner_excluded', 'system_excluded'].includes(entry.disposition)) throw new ScopeError('Invalid approved source URL.');
    if (entry.disposition === 'owner_excluded' && exclusionBlockReason({ ...entry, depth: 0, state: 'pending' }, [], approval.sourceUrl)) throw new ScopeError('Protected exclusion.');
    if (entry.disposition === 'required' && !isCrawlablePath(entry.url)) throw new ScopeError('Required source must be public HTML.');
    if (entry.disposition === 'system_excluded' && (entry.reason !== 'outside_html_scope' || isCrawlablePath(entry.url))) throw new ScopeError('Invalid system exclusion.');
    seen.add(entry.url);
  }
  if (!approval.inventory.some(entry => entry.url === normalizeUrl(approval.sourceUrl) && entry.disposition === 'required') || !approval.inventory.some(entry => entry.disposition === 'owner_excluded')) throw new ScopeError('Invalid limited scope.');
}
export function validateApprovedCrawl(approval: ScopeApproval, manifest: CrawlManifest): void {
  validateApprovalIdentity(approval);
  if (manifest.limits.length || manifest.maxPages !== approval.budget.maxPages || manifest.maxRenderedPages !== approval.budget.maxRenderedPages) throw new ScopeError('Approved crawl limits were not satisfied.');
  const actual = new Map(manifest.entries.map(entry => [entry.url, entry]));
  if (actual.size !== manifest.entries.length || actual.size !== approval.inventory.length) throw new ScopeError('Source inventory changed; review again.');
  for (const source of approval.inventory) {
    const entry = actual.get(source.url);
    if (!entry) throw new ScopeError('Source inventory changed; review again.');
    if (entry.finalUrl && (!actual.has(entry.finalUrl) || approval.inventory.find(item => item.url === entry.finalUrl)?.disposition !== 'required')) throw new ScopeError('Redirect changed approved sources.');
    if (source.disposition === 'owner_excluded') {
      if (entry.state !== 'excluded' || entry.reason !== 'owner_excluded') throw new ScopeError('Excluded source was processed.');
    } else if (source.disposition === 'system_excluded') {
      if (entry.state !== 'excluded' || entry.reason !== source.reason) throw new ScopeError('System exclusion changed; review again.');
    } else if (!['fetched', 'duplicate'].includes(entry.state) || !entry.chunkCount) throw new ScopeError('Required included source was not usefully indexed.');
  }
}
export function validateScopeDocuments(snapshot: KnowledgeSnapshot, approval: ScopeApproval): void {
  if (!snapshot.crawlManifest || snapshot.sourceUrl !== approval.sourceUrl) throw new ScopeError('Missing approved manifest.');
  if (snapshot.crawlManifest.completeWithinScope !== false || snapshot.publication?.completeness !== 'partial') throw new ScopeError('Limited scope must preserve raw coverage limitations.');
  validateApprovedCrawl(approval, snapshot.crawlManifest);
  const required = new Set(approval.inventory.filter(entry => entry.disposition === 'required').map(entry => entry.url));
  if (snapshot.pages.some(page => !required.has(page.url)) || snapshot.documents.some(doc => !required.has(doc.url) || doc.sourceAliases?.some(alias => !required.has(alias.url)))) throw new ScopeError('Snapshot contains unapproved sources.');
  for (const source of required) {
    const entry = snapshot.crawlManifest.entries.find(entry => entry.url === source)!;
    const target = entry.state === 'duplicate' ? entry.canonical : entry.finalUrl ?? source;
    if (!target || !required.has(target) || !snapshot.pages.some(page => page.url === target) || !snapshot.documents.some(doc => doc.url === target || doc.sourceAliases?.some(alias => alias.url === target))) throw new ScopeError('Approved source has no valid page/vector coverage.');
  }
}
