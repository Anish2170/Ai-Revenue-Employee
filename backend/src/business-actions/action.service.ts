import { prisma } from '../db/prisma.js';
import { assertWebsiteOwnership } from '../websites/website.service.js';
import { writeAuditLog } from '../audit/audit.service.js';
import { invalidateTenantCacheForWebsite } from '../tenant/tenant.resolver.js';
import type { BusinessActionConfig, BusinessActionDestinationType, BusinessActionWithStats } from './action.types.js';
import { loadSnapshotFile, websiteSnapshotPath } from '../vectorstore/persistence.js';
import { DISCOVERED_ACTION_INTENTS } from './discovered-action.types.js';
import type { DiscoveredActionGraph, DiscoveredActionCandidate, DiscoveredActionIntent } from './discovered-action.types.js';

export const STARTER_ACTIONS: Array<Omit<BusinessActionConfig, 'enabled' | 'destination'> & { destination: string; sortOrder: number }> = [
  { actionId: 'book_demo', label: 'Book Demo', destinationType: 'URL', destination: '', sortOrder: 10 },
  { actionId: 'contact_sales', label: 'Contact Sales', destinationType: 'URL', destination: '', sortOrder: 20 },
  { actionId: 'pricing', label: 'View Pricing', destinationType: 'URL', destination: '', sortOrder: 30 },
  { actionId: 'learn_more', label: 'Learn More', destinationType: 'URL', destination: '', sortOrder: 40 },
  { actionId: 'start_free_trial', label: 'Start Free Trial', destinationType: 'URL', destination: '', sortOrder: 50 },
  { actionId: 'whatsapp', label: 'WhatsApp', destinationType: 'WHATSAPP', destination: '', sortOrder: 60 },
  { actionId: 'call_now', label: 'Call Now', destinationType: 'PHONE', destination: '', sortOrder: 70 },
  { actionId: 'contact_support', label: 'Contact Support', destinationType: 'EMAIL', destination: '', sortOrder: 80 },
];

export interface UpsertBusinessActionInput {
  actionId: string;
  label: string;
  destinationType: BusinessActionDestinationType;
  destination: string;
  enabled: boolean;
}

const ACTION_ID_RE = /^[a-z][a-z0-9_]{1,63}$/;

export class BusinessActionValidationError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_BUSINESS_ACTION';
}

export class ActionOverrideValidationError extends Error {
  readonly status = 400;
  readonly code = 'INVALID_ACTION_URL_OVERRIDE';
}

export class ActionOverrideStorageError extends Error {
  readonly status = 503;
  readonly code = 'ACTION_URL_OVERRIDE_STORAGE_UNAVAILABLE';
}

export async function listBusinessActions(organizationId: string, websiteId: string): Promise<BusinessActionWithStats[]> {
  await assertWebsiteOwnership(organizationId, websiteId);
  await seedStarterActions(organizationId, websiteId);
  const actions = await prisma.businessAction.findMany({
    where: { organizationId, websiteId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  const stats = await getActionStats(organizationId, websiteId, actions.map((a) => a.actionId));
  return actions.map((action) => ({
    id: action.id,
    actionId: action.actionId,
    label: action.label,
    destinationType: action.destinationType,
    destination: action.destination,
    enabled: action.enabled,
    isStarter: action.isStarter,
    sortOrder: action.sortOrder,
    usageCount: stats.get(action.actionId)?.clicked ?? 0,
    ctr: ctr(stats.get(action.actionId)),
    lastUsed: stats.get(action.actionId)?.lastUsed ?? null,
  }));
}

export async function getEnabledBusinessActions(websiteId: string): Promise<BusinessActionConfig[]> {
  const graph = await getDiscoveredActionGraph(websiteId);
  if (graph) return actionsFromGraph(graph, await getOverrideMap(websiteId));

  await seedStarterActionsForWebsite(websiteId);
  const actions = await prisma.businessAction.findMany({
    where: { websiteId, enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return actions
    .filter((action) => hasExecutableDestination(action.destinationType, action.destination))
    .map((action) => ({
      actionId: action.actionId,
      label: action.label,
      destinationType: action.destinationType,
      destination: action.destination,
      enabled: action.enabled,
    }));
}

export async function getDiscoveredActionGraph(websiteId: string): Promise<DiscoveredActionGraph | null> {
  const snapshot = await loadSnapshotFile(websiteSnapshotPath(websiteId));
  return snapshot?.actionGraph ?? null;
}

export async function resolveDiscoveredAction(websiteId: string, intent: string | null | undefined): Promise<BusinessActionConfig | null> {
  if (!intent) return null;
  const graph = await getDiscoveredActionGraph(websiteId);
  if (!graph) return null;
  const direct = graph.nodes.find((node) => node.intent === intent);
  if (direct) {
    const override = await getOverrideForIntent(websiteId, direct.intent);
    const overrideCandidate = override ? findCandidateByUrl(direct, override.url) : null;
    if (overrideCandidate) return actionFromCandidate(direct.intent, overrideCandidate);
    return actionFromCandidate(direct.intent, direct.preferred);
  }
  const node = closestSemanticNode(graph, intent);
  if (!node) return null;
  return actionFromCandidate(node.intent, node.preferred);
}

export async function createBusinessAction(
  organizationId: string,
  userId: string,
  websiteId: string,
  input: UpsertBusinessActionInput,
): Promise<BusinessActionWithStats> {
  await assertWebsiteOwnership(organizationId, websiteId);
  const clean = validateActionInput(input);
  const max = await prisma.businessAction.aggregate({ where: { websiteId }, _max: { sortOrder: true } });
  try {
    await prisma.businessAction.create({
      data: {
        organizationId,
        websiteId,
        ...clean,
        isStarter: false,
        sortOrder: (max._max.sortOrder ?? 80) + 10,
      },
    });
  } catch (err) {
    throw new BusinessActionValidationError('Action ID already exists for this website.');
  }
  await afterActionChanged(organizationId, userId, websiteId, 'business_action.created', clean.actionId);
  return mustFindAction(organizationId, websiteId, clean.actionId);
}

export async function updateBusinessAction(
  organizationId: string,
  userId: string,
  websiteId: string,
  actionId: string,
  input: Partial<UpsertBusinessActionInput>,
): Promise<BusinessActionWithStats> {
  await assertWebsiteOwnership(organizationId, websiteId);
  await seedStarterActions(organizationId, websiteId);
  const existing = await prisma.businessAction.findUnique({ where: { websiteId_actionId: { websiteId, actionId } } });
  if (!existing || existing.organizationId !== organizationId) throw new BusinessActionValidationError('Business action not found.');
  const clean = validateActionInput({
    actionId: existing.actionId,
    label: input.label ?? existing.label,
    destinationType: input.destinationType ?? existing.destinationType,
    destination: input.destination ?? existing.destination,
    enabled: input.enabled ?? existing.enabled,
  });
  await prisma.businessAction.update({
    where: { id: existing.id },
    data: {
      label: clean.label,
      destinationType: clean.destinationType,
      destination: clean.destination,
      enabled: clean.enabled,
    },
  });
  await afterActionChanged(organizationId, userId, websiteId, 'business_action.updated', actionId);
  return mustFindAction(organizationId, websiteId, actionId);
}

export async function deleteBusinessAction(organizationId: string, userId: string, websiteId: string, actionId: string): Promise<void> {
  await assertWebsiteOwnership(organizationId, websiteId);
  const action = await prisma.businessAction.findUnique({ where: { websiteId_actionId: { websiteId, actionId } } });
  if (!action || action.organizationId !== organizationId) throw new BusinessActionValidationError('Business action not found.');
  if (action.isStarter) {
    await prisma.businessAction.update({ where: { id: action.id }, data: { enabled: false, destination: '' } });
  } else {
    await prisma.businessAction.delete({ where: { id: action.id } });
  }
  await afterActionChanged(organizationId, userId, websiteId, 'business_action.deleted', actionId);
}


export async function setDiscoveredActionUrlOverride(
  organizationId: string,
  userId: string,
  websiteId: string,
  intent: string,
  url: string,
): Promise<{ intent: string; url: string }> {
  await assertWebsiteOwnership(organizationId, websiteId);
  if (!isDiscoveredIntent(intent)) throw new ActionOverrideValidationError('Unknown discovered action intent.');
  const graph = await getDiscoveredActionGraph(websiteId);
  const node = graph?.nodes.find((item) => item.intent === intent);
  if (!node) throw new ActionOverrideValidationError('This intent was not discovered in the latest Knowledge Build.');
  const candidate = findCandidateByUrl(node, url);
  if (!candidate) throw new ActionOverrideValidationError('Choose a URL discovered during the latest Knowledge Build.');

  try {
    await prisma.actionUrlOverride.upsert({
      where: { websiteId_intent: { websiteId, intent } },
      create: { organizationId, websiteId, intent, url: candidate.url },
      update: { url: candidate.url },
    });
  } catch (err) {
    if (isMissingOverrideStorageError(err)) {
      throw new ActionOverrideStorageError('Preferred URL override storage is not ready. Apply migration 20260712120000_add_action_url_overrides and try again.');
    }
    throw err;
  }
  invalidateTenantCacheForWebsite(websiteId);
  await writeAuditLog({ action: 'action_url_override.updated', organizationId, userId, targetType: 'website_action', targetId: intent, metadata: { url: candidate.url } }).catch((err) => {
    console.warn('[website-actions] failed to write preferred URL override audit log.', err);
  });
  return { intent, url: candidate.url };
}

export async function clearDiscoveredActionUrlOverride(organizationId: string, userId: string, websiteId: string, intent: string): Promise<void> {
  await assertWebsiteOwnership(organizationId, websiteId);
  if (!isDiscoveredIntent(intent)) throw new ActionOverrideValidationError('Unknown discovered action intent.');
  try {
    await prisma.actionUrlOverride.deleteMany({ where: { organizationId, websiteId, intent } });
  } catch (err) {
    if (isMissingOverrideStorageError(err)) {
      throw new ActionOverrideStorageError('Preferred URL override storage is not ready. Apply migration 20260712120000_add_action_url_overrides and try again.');
    }
    throw err;
  }
  invalidateTenantCacheForWebsite(websiteId);
  await writeAuditLog({ action: 'action_url_override.deleted', organizationId, userId, targetType: 'website_action', targetId: intent }).catch((err) => {
    console.warn('[website-actions] failed to write preferred URL override audit log.', err);
  });
}

export async function reconcileActionUrlOverridesAfterBuild(organizationId: string, websiteId: string): Promise<string[]> {
  const graph = await getDiscoveredActionGraph(websiteId);
  if (!graph) return [];
  let overrides: Array<{ id: string; intent: string; url: string }> = [];
  try {
    overrides = await prisma.actionUrlOverride.findMany({ where: { organizationId, websiteId }, select: { id: true, intent: true, url: true } });
  } catch (err) {
    console.warn('[website-actions] override reconciliation skipped because override storage is unavailable.', err);
    return [];
  }
  const removed: string[] = [];
  for (const override of overrides) {
    const node = graph.nodes.find((item) => item.intent === override.intent);
    if (!node || !findCandidateByUrl(node, override.url)) {
      await prisma.actionUrlOverride.delete({ where: { id: override.id } });
      await writeAuditLog({
        action: 'action_url_override.removed_missing_url',
        organizationId,
        targetType: 'website_action_override',
        targetId: websiteId,
        metadata: { intent: override.intent, url: override.url, reason: 'discovered_url_missing_after_build' },
      });
      removed.push(override.intent);
    }
  }
  if (removed.length > 0) invalidateTenantCacheForWebsite(websiteId);
  return removed;
}
export function findBusinessAction(actions: BusinessActionConfig[], actionId: string | null | undefined): BusinessActionConfig | null {
  if (!actionId) return null;
  return actions.find((action) => action.enabled && action.actionId === actionId) ?? null;
}

export function renderAvailableActions(actions: BusinessActionConfig[]): string[] {
  if (actions.length === 0) return ['Available Actions: none. Do not include an action.'];
  return ['Available Actions (choose only an Action ID from this list; never invent an action, URL, phone number, email, or WhatsApp number):', ...actions.map((a) => `${a.actionId}\n${a.label}`)];
}

async function seedStarterActions(organizationId: string, websiteId: string): Promise<void> {
  for (const starter of STARTER_ACTIONS) {
    await prisma.businessAction.upsert({
      where: { websiteId_actionId: { websiteId, actionId: starter.actionId } },
      create: { organizationId, websiteId, ...starter, enabled: false, isStarter: true },
      update: { isStarter: true, sortOrder: starter.sortOrder },
    });
  }
}

async function seedStarterActionsForWebsite(websiteId: string): Promise<void> {
  const website = await prisma.website.findUnique({ where: { id: websiteId }, select: { organizationId: true } });
  if (!website) return;
  await seedStarterActions(website.organizationId, websiteId);
}

function validateActionInput(input: UpsertBusinessActionInput): UpsertBusinessActionInput {
  const actionId = input.actionId.trim();
  const label = input.label.trim();
  const destination = input.destination.trim();
  if (!ACTION_ID_RE.test(actionId)) throw new BusinessActionValidationError('Action ID must be snake_case and 2-64 characters.');
  if (label.length < 1 || label.length > 80) throw new BusinessActionValidationError('Display label must be 1-80 characters.');
  if (destination.length > 2048) throw new BusinessActionValidationError('Destination is too long.');
  if (!hasValidDestination(input.destinationType, destination, input.enabled)) {
    throw new BusinessActionValidationError(`Invalid destination for ${input.destinationType}.`);
  }
  return { actionId, label, destinationType: input.destinationType, destination, enabled: input.enabled };
}

function hasExecutableDestination(type: BusinessActionDestinationType, destination: string): boolean {
  return hasValidDestination(type, destination, true);
}

function hasValidDestination(type: BusinessActionDestinationType, destination: string, enabled: boolean): boolean {
  if (!enabled && destination.length === 0) return true;
  if (type === 'CHAT') return destination.length === 0 || destination === 'chat';
  if (type === 'URL') return isHttpUrl(destination);
  if (type === 'WHATSAPP') return isHttpUrl(destination) && /(^|\.)wa\.me$|(^|\.)whatsapp\.com$/i.test(safeHost(destination));
  if (type === 'PHONE') return /^tel:\+?[0-9][0-9\-()\s]{5,30}$/.test(destination) || /^\+?[0-9][0-9\-()\s]{5,30}$/.test(destination);
  if (type === 'EMAIL') return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(destination) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(destination);
  return false;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

async function afterActionChanged(organizationId: string, userId: string, websiteId: string, auditAction: string, actionId: string): Promise<void> {
  invalidateTenantCacheForWebsite(websiteId);
  await writeAuditLog({ action: auditAction, organizationId, userId, targetType: 'business_action', targetId: actionId });
}

async function mustFindAction(organizationId: string, websiteId: string, actionId: string): Promise<BusinessActionWithStats> {
  const action = (await listBusinessActions(organizationId, websiteId)).find((a) => a.actionId === actionId);
  if (!action) throw new BusinessActionValidationError('Business action not found.');
  return action;
}

interface ActionStats {
  displayed: number;
  clicked: number;
  lastUsed: Date | null;
}

async function getActionStats(organizationId: string, websiteId: string, actionIds: string[]): Promise<Map<string, ActionStats>> {
  const stats = new Map<string, ActionStats>();
  for (const actionId of actionIds) stats.set(actionId, { displayed: 0, clicked: 0, lastUsed: null });
  if (actionIds.length === 0) return stats;
  const rows = await prisma.analyticsEvent.findMany({
    where: {
      organizationId,
      websiteId,
      actionId: { in: actionIds },
      eventName: { in: ['popup_displayed', 'popup_clicked'] },
    },
    select: { actionId: true, eventName: true, occurredAt: true },
    take: 5000,
  });
  for (const row of rows) {
    if (!row.actionId) continue;
    const stat = stats.get(row.actionId) ?? { displayed: 0, clicked: 0, lastUsed: null };
    if (row.eventName === 'popup_displayed') stat.displayed += 1;
    if (row.eventName === 'popup_clicked') {
      stat.clicked += 1;
      if (!stat.lastUsed || row.occurredAt > stat.lastUsed) stat.lastUsed = row.occurredAt;
    }
    stats.set(row.actionId, stat);
  }
  return stats;
}

function ctr(stats?: ActionStats): number {
  if (!stats || stats.displayed === 0) return 0;
  return stats.clicked / stats.displayed;
}
function actionsFromGraph(graph: DiscoveredActionGraph, overrides = new Map<string, string>()): BusinessActionConfig[] {
  return graph.nodes.map((node) => actionFromCandidate(node.intent, findCandidateByUrl(node, overrides.get(node.intent)) ?? node.preferred));
}

function actionFromCandidate(intent: DiscoveredActionIntent, candidate: DiscoveredActionGraph['nodes'][number]['preferred']): BusinessActionConfig {
  return {
    actionId: intent,
    label: candidate.label,
    destinationType: 'URL',
    destination: candidate.url,
    enabled: true,
  };
}

function closestSemanticNode(graph: DiscoveredActionGraph, intent: string): DiscoveredActionGraph['nodes'][number] | null {
  const normalized = intent.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const aliases: Record<string, DiscoveredActionIntent> = {
    talk_with_specialist: 'book_demo',
    talk_to_sales: 'book_demo',
    contact_sales: 'book_demo',
    schedule_call: 'book_demo',
    request_consultation: 'book_demo',
    start_trial: 'free_trial',
    get_started: 'free_trial',
    docs: 'documentation',
    help: 'support',
  };
  const mapped = aliases[normalized];
  return mapped ? graph.nodes.find((node) => node.intent === mapped) ?? null : null;
}

export async function getWebsiteActionsDashboard(organizationId: string, websiteId: string) {
  await assertWebsiteOwnership(organizationId, websiteId);
  const snapshot = await loadSnapshotFile(websiteSnapshotPath(websiteId));
  const graph = snapshot?.actionGraph ?? null;
  const latestBuild = await prisma.knowledgeBuild.findFirst({
    where: { organizationId, websiteId },
    orderBy: { startedAt: 'desc' },
    select: { startedAt: true, finishedAt: true, status: true, currentPhase: true, error: true, snapshotId: true },
  });

  if (!graph) {
    return {
      summary: emptyActionsSummary(snapshot?.createdAt ?? latestBuild?.finishedAt ?? null),
      timestamps: timestamps(snapshot?.createdAt ?? null, latestBuild),
      groups: [],
      actions: [],
      websiteMap: [],
    };
  }

  const intentIds = graph.nodes.map((node) => node.intent);
  const [analytics, overrideMap, removedOverrideNotice] = await Promise.all([
    getIntentAnalytics(organizationId, websiteId, intentIds),
    getOverrideMap(websiteId),
    getRemovedOverrideNotice(organizationId, websiteId, latestBuild?.startedAt ?? null),
  ]);
  const actions = graph.nodes.map((node) => {
    const automaticCandidate = node.preferred;
    const overrideUrl = overrideMap.get(node.intent) ?? null;
    const overrideCandidate = findCandidateByUrl(node, overrideUrl);
    const candidate = overrideCandidate ?? automaticCandidate;
    const status = actionStatus(candidate.confidence);
    const stats = analytics.get(node.intent) ?? { popupUses: 0, clicks: 0, conversions: 0 };
    const rawCandidates = node.rawCandidates ?? node.candidates;
    const pagesFound = Array.from(new Set(rawCandidates.map((item) => item.pageUrl)));
    const alternativeUrls = node.candidates.filter((other) => other.url !== candidate.url).map((other) => other.url);
    const occurrences = rawCandidates.length;
    return {
      id: node.intent,
      intent: node.intent,
      actionLabel: candidate.label,
      destinationUrl: candidate.url,
      automaticDestinationUrl: automaticCandidate.url,
      hasManualOverride: Boolean(overrideCandidate),
      overrideUrl,
      foundOnPage: candidate.pageUrl,
      pageTitle: candidate.pageTitle,
      detectionMethod: candidate.detectionMethod,
      confidence: candidate.confidence,
      status,
      occurrences,
      alternativeUrls,
      pagesFound,
      analytics: { ...stats, ctr: stats.popupUses === 0 ? 0 : stats.clicks / stats.popupUses },
      details: {
        detectedLabel: candidate.label,
        resolvedIntent: node.intent,
        destinationUrl: candidate.url,
      automaticDestinationUrl: automaticCandidate.url,
      hasManualOverride: Boolean(overrideCandidate),
      overrideUrl,
        pageUrl: candidate.pageUrl,
        pageTitle: candidate.pageTitle,
        whereFound: whereFound(candidate),
        domContext: candidate.domLocation,
        surroundingHeading: candidate.surroundingHeading,
        detectionMethod: candidate.detectionMethod,
        rule: candidate.rule,
        confidenceScore: candidate.confidence,
        occurrences,
        pagesFound,
        alternativeUrls,
        selectableUrls: uniqueCandidateUrls(node),
        alternativeMatches: node.candidates
          .filter((other) => other.url !== candidate.url)
          .map((other) => ({ label: other.label, url: other.url, confidence: other.confidence, page: other.pageUrl, method: other.detectionMethod, occurrences: other.rankSignals.occurrenceCount ?? 1 })),
        whySelected: candidate.why,
      },
    };
  });

  const groups = graph.nodes.map((node) => ({
    intent: node.intent,
    preferredLabel: node.preferred.label,
    preferredUrl: node.preferred.url,
    count: node.candidates.length,
    averageConfidence: node.candidates.reduce((sum, item) => sum + item.confidence, 0) / Math.max(1, node.candidates.length),
    labels: node.candidates.map((candidate) => candidate.label),
  }));

  return {
    notices: removedOverrideNotice ? [removedOverrideNotice] : [],
    summary: {
      discoveredActions: actions.length,
      recognizedIntents: graph.nodes.length,
      highConfidence: actions.filter((action) => action.status === 'verified').length,
      needsReview: actions.filter((action) => action.status !== 'verified').length,
      lastUpdated: graph.generatedAt,
    },
    timestamps: timestamps(graph.generatedAt, latestBuild),
    groups,
    actions,
    websiteMap: graph.nodes.map((node) => {
      const candidate = findCandidateByUrl(node, overrideMap.get(node.intent)) ?? node.preferred;
      return { intent: node.intent, label: candidate.label, url: candidate.url };
    }),
  };
}

function emptyActionsSummary(lastUpdated: Date | string | null) {
  return { discoveredActions: 0, recognizedIntents: 0, highConfidence: 0, needsReview: 0, lastUpdated };
}

function timestamps(lastDiscovery: Date | string | null, latestBuild: LatestWebsiteActionBuild | null) {
  const stageStatuses = buildStageStatuses(latestBuild, Boolean(lastDiscovery));
  return {
    lastCrawl: lastDiscovery,
    lastBuild: latestBuild?.finishedAt ?? latestBuild?.startedAt ?? null,
    lastDiscovery,
    buildStatus: displayBuildStatus(latestBuild, stageStatuses),
    stageStatuses,
  };
}

type StageStatus = 'success' | 'failed' | 'running' | 'pending' | 'unknown';
type LatestWebsiteActionBuild = {
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  currentPhase: string | null;
  error: string | null;
  snapshotId: string | null;
};

const BUILD_STAGE_ORDER = ['crawling', 'chunking', 'embedding', 'action_discovery', 'saving'] as const;
const BUILD_STAGE_LABELS: Record<(typeof BUILD_STAGE_ORDER)[number], string> = {
  crawling: 'Crawler',
  chunking: 'Chunking',
  embedding: 'Embeddings',
  action_discovery: 'Action Discovery',
  saving: 'Snapshot Save',
};

function buildStageStatuses(latestBuild: LatestWebsiteActionBuild | null, hasActionDiscovery: boolean): Array<{ stage: string; label: string; status: StageStatus; error?: string }> {
  if (!latestBuild) return [];
  const currentIndex = Math.max(0, BUILD_STAGE_ORDER.indexOf(latestBuild.currentPhase as (typeof BUILD_STAGE_ORDER)[number]));
  return BUILD_STAGE_ORDER.map((stage, index) => {
    let status: StageStatus = 'pending';
    if (latestBuild.status === 'SUCCESS') status = 'success';
    else if (latestBuild.status === 'RUNNING') status = index < currentIndex ? 'success' : index === currentIndex ? 'running' : 'pending';
    else if (latestBuild.status === 'FAILED') status = index < currentIndex ? 'success' : index === currentIndex ? 'failed' : 'pending';
    if (stage === 'action_discovery' && hasActionDiscovery) status = 'success';
    return { stage, label: BUILD_STAGE_LABELS[stage], status, ...(status === 'failed' && latestBuild.error ? { error: latestBuild.error } : {}) };
  });
}

function displayBuildStatus(latestBuild: LatestWebsiteActionBuild | null, stageStatuses: Array<{ status: StageStatus }>): string | null {
  if (!latestBuild) return null;
  if (latestBuild.status !== 'FAILED') return latestBuild.status;
  return stageStatuses.some((stage) => stage.status === 'success') ? 'PARTIAL_SUCCESS' : 'FAILED';
}

function actionStatus(confidence: number): 'verified' | 'needs_review' | 'unknown' {
  if (confidence >= 0.8) return 'verified';
  if (confidence >= 0.5) return 'needs_review';
  return 'unknown';
}

function whereFound(candidate: DiscoveredActionGraph['nodes'][number]['preferred']): string[] {
  const signals = candidate.rankSignals;
  return [
    signals.navigation ? 'Navigation' : null,
    signals.heroCta ? 'Hero' : null,
    signals.footer ? 'Footer' : null,
    signals.button ? 'Button' : null,
    signals.form ? 'Form' : null,
    candidate.anchorText ? 'Anchor' : null,
    signals.card ? 'Card' : null,
  ].filter(Boolean) as string[];
}

async function getIntentAnalytics(organizationId: string, websiteId: string, intents: string[]): Promise<Map<string, { popupUses: number; clicks: number; conversions: number }>> {
  const stats = new Map<string, { popupUses: number; clicks: number; conversions: number }>();
  for (const intent of intents) stats.set(intent, { popupUses: 0, clicks: 0, conversions: 0 });
  if (intents.length === 0) return stats;
  try {
    const rows = await prisma.analyticsEvent.findMany({
      where: { organizationId, websiteId, actionId: { in: intents }, eventName: { in: ['popup_displayed', 'popup_clicked', 'conversion', 'cta_conversion'] } },
      select: { actionId: true, eventName: true },
      take: 10000,
    });
    for (const row of rows) {
      if (!row.actionId) continue;
      const stat = stats.get(row.actionId) ?? { popupUses: 0, clicks: 0, conversions: 0 };
      if (row.eventName === 'popup_displayed') stat.popupUses += 1;
      if (row.eventName === 'popup_clicked') stat.clicks += 1;
      if (row.eventName === 'conversion' || row.eventName === 'cta_conversion') stat.conversions += 1;
      stats.set(row.actionId, stat);
    }
  } catch (err) {
    console.warn('[website-actions] analytics enrichment unavailable; returning discovered actions without usage stats.', err);
  }
  return stats;
}




async function getOverrideMap(websiteId: string): Promise<Map<string, string>> {
  try {
    const rows = await prisma.actionUrlOverride.findMany({ where: { websiteId }, select: { intent: true, url: true } });
    return new Map(rows.map((row) => [row.intent, row.url]));
  } catch (err) {
    console.warn('[website-actions] preferred URL overrides unavailable; returning automatic discovered destinations.', err);
    return new Map();
  }
}

async function getOverrideForIntent(websiteId: string, intent: string) {
  try {
    return await prisma.actionUrlOverride.findUnique({ where: { websiteId_intent: { websiteId, intent } }, select: { url: true } });
  } catch (err) {
    console.warn('[website-actions] preferred URL override lookup unavailable; using automatic discovered destination.', err);
    return null;
  }
}

function uniqueCandidateUrls(node: DiscoveredActionGraph['nodes'][number]): string[] {
  return Array.from(new Set(node.candidates.map((candidate) => candidate.url)));
}

function findCandidateByUrl(node: DiscoveredActionGraph['nodes'][number], url: string | null | undefined): DiscoveredActionCandidate | null {
  if (!url) return null;
  return node.candidates.find((candidate) => candidate.url === url) ?? null;
}

function isDiscoveredIntent(intent: string): intent is DiscoveredActionIntent {
  return DISCOVERED_ACTION_INTENTS.includes(intent as DiscoveredActionIntent);
}
async function getRemovedOverrideNotice(organizationId: string, websiteId: string, since: Date | null): Promise<string | null> {
  if (!since) return null;
  try {
    const row = await prisma.auditLog.findFirst({
      where: {
        organizationId,
        action: 'action_url_override.removed_missing_url',
        targetType: 'website_action_override',
        targetId: websiteId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
    });
    return row ? 'The previously selected URL no longer exists. The system has reverted to the automatically detected destination.' : null;
  } catch (err) {
    console.warn('[website-actions] override notice lookup unavailable.', err);
    return null;
  }
}

function isMissingOverrideStorageError(err: unknown): boolean {
  const maybe = err as { code?: unknown; message?: unknown; meta?: { modelName?: unknown; table?: unknown } };
  const message = typeof maybe.message === 'string' ? maybe.message : '';
  return maybe.code === 'P2021'
    || maybe.code === 'P2022'
    || maybe.meta?.modelName === 'ActionUrlOverride'
    || maybe.meta?.table === 'ActionUrlOverride'
    || /ActionUrlOverride|actionUrlOverride/i.test(message);
}
