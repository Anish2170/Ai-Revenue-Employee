/**
 * Tenant resolver — maps a public siteId to a full TenantContext.
 *
 * Walks the ownership chain: Widget.siteId → Website → Organization.
 * Results are cached (TTL-based) to avoid hitting the DB on every widget request.
 */
import { prisma } from '../db/prisma.js';
import { hasDatabase } from '../config/index.js';
import { getEnabledBusinessActions } from '../business-actions/action.service.js';
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';

export interface TenantContext {
  organizationId: string;
  websiteId: string;
  siteId: string;
  websiteUrl: string;
  instructions: BusinessInstructions;
  businessActions: BusinessActionConfig[];
}

interface CachedTenant {
  tenant: TenantContext;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CachedTenant>();

export class TenantNotFoundError extends Error {
  readonly status = 404;
  readonly code = 'TENANT_NOT_FOUND';
  constructor(siteId: string) {
    super(`No active widget found for siteId "${siteId}".`);
  }
}

export class TenantDisabledError extends Error {
  readonly status = 403;
  readonly code = 'WIDGET_DISABLED';
  constructor(siteId: string) {
    super(`Widget for siteId "${siteId}" is disabled.`);
  }
}

/**
 * Resolve a public siteId to its tenant context.
 * @throws TenantNotFoundError if the siteId doesn't exist or the website is deleted.
 * @throws TenantDisabledError if the widget is disabled.
 */
export async function resolveTenant(siteId: string): Promise<TenantContext> {
  if (!hasDatabase) {
    throw new Error('Database not configured — cannot resolve tenant.');
  }

  const cached = cache.get(siteId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tenant;
  }

  const widget = await prisma.widget.findUnique({
    where: { siteId },
    include: {
      website: {
        include: {
          organization: true,
          instruction: true,
        },
      },
    },
  });

  if (!widget || !widget.website || widget.website.deletedAt) {
    throw new TenantNotFoundError(siteId);
  }

  if (widget.status === 'DISABLED') {
    throw new TenantDisabledError(siteId);
  }

  const ws = widget.website;
  const instr = ws.instruction;

  const businessActions = await getEnabledBusinessActions(ws.id);

  const instructions: BusinessInstructions = {
    businessName: instr?.businessName ?? ws.name,
    companyDescription: instr?.companyDescription ?? ws.description ?? undefined,
    role: instr?.role ?? undefined,
    tone: instr?.tone ?? 'Professional, helpful, and concise.',
    goal: instr?.goal ?? undefined,
    context: instr?.context ?? undefined,
    rules: instr?.rules ?? undefined,
    fallbackMessage: instr?.fallbackMessage ?? undefined,
    alwaysBookDemo: instr?.alwaysBookDemo ?? false,
    avoidDiscounts: instr?.avoidDiscounts ?? false,
    language: instr?.language ?? ws.primaryLanguage ?? 'English',
    websiteUrl: instr?.websiteUrl ?? ws.url,
  };

  const tenant: TenantContext = {
    organizationId: ws.organizationId,
    websiteId: ws.id,
    siteId: widget.siteId,
    websiteUrl: ws.url,
    instructions,
    businessActions,
  };

  cache.set(siteId, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });

  // Fire-and-forget: update lastRequestAt + increment counter
  prisma.widget.update({
    where: { id: widget.id },
    data: { lastRequestAt: new Date(), requestCount: { increment: 1 } },
  }).catch(() => {});

  return tenant;
}

/** Invalidate the cache for a siteId (e.g. after instruction update). */
export function invalidateTenantCache(siteId?: string): void {
  if (siteId) {
    cache.delete(siteId);
  } else {
    cache.clear();
  }
}


/** Invalidate any cached tenant context for a website after business-owned config changes. */
export function invalidateTenantCacheForWebsite(websiteId: string): void {
  for (const [siteId, cached] of cache.entries()) {
    if (cached.tenant.websiteId === websiteId) cache.delete(siteId);
  }
}
