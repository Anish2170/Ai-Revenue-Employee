/**
 * Emergency tenant resolver for public widget requests when the DB tenant lookup
 * is unavailable. It never guesses from siteId and never falls back to the
 * legacy/global knowledge base. It can only resolve a tenant by matching the
 * browser Origin/Referer host to an existing per-website knowledge snapshot.
 */
import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { loadSnapshotFile } from '../vectorstore/persistence.js';
import type { TenantContext } from './tenant.resolver.js';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const knowledgeDir = resolve(backendRoot, config.knowledgeDir);

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^www\./, '');
}

function hostFromUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeHost(new URL(value).hostname);
  } catch {
    return null;
  }
}

function businessNameFromHost(host: string): string {
  return host.replace(/^www\./, '');
}

export interface OriginSnapshotTenantResult {
  tenant: TenantContext;
  matchedBy: 'origin' | 'referer';
  sourceUrl: string;
}

export async function resolveTenantFromRequestOrigin(input: {
  siteId: string;
  origin?: string;
  referer?: string;
}): Promise<OriginSnapshotTenantResult | null> {
  const candidates = [
    { matchedBy: 'origin' as const, host: hostFromUrl(input.origin) },
    { matchedBy: 'referer' as const, host: hostFromUrl(input.referer) },
  ].filter((c): c is { matchedBy: 'origin' | 'referer'; host: string } => Boolean(c.host));

  if (candidates.length === 0) return null;

  let files: string[];
  try {
    files = (await readdir(knowledgeDir)).filter((name) => name.endsWith('.json'));
  } catch {
    return null;
  }

  const matches: OriginSnapshotTenantResult[] = [];
  for (const file of files) {
    const websiteId = file.replace(/\.json$/i, '');
    const snapshot = await loadSnapshotFile(resolve(knowledgeDir, file));
    if (!snapshot) continue;

    const snapshotHost = hostFromUrl(snapshot.sourceUrl);
    if (!snapshotHost) continue;

    const matched = candidates.find((candidate) => candidate.host === snapshotHost);
    if (!matched) continue;

    const businessName = snapshot.documents[0]?.title?.trim() || businessNameFromHost(snapshotHost);
    matches.push({
      matchedBy: matched.matchedBy,
      sourceUrl: snapshot.sourceUrl,
      tenant: {
        organizationId: 'origin-snapshot',
        websiteId,
        siteId: input.siteId,
        websiteUrl: snapshot.sourceUrl,
        instructions: {
          businessName,
          tone: 'Professional, helpful, and concise.',
          alwaysBookDemo: false,
          avoidDiscounts: false,
          language: snapshot.documents[0]?.language || 'English',
        },
      },
    });
  }

  if (matches.length !== 1) return null;
  return matches[0];
}
