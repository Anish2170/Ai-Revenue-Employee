/**
 * Website service — higher-level org-scoped operations.
 *
 * The repo layer enforces `organizationId`; this layer enforces ownership at
 * the route boundary with `assertWebsiteOwnership`.
 */
import * as repo from './website.repository.js';
import { writeAuditLog } from '../audit/audit.service.js';

export interface CreateWebsiteInput {
  name: string;
  url: string;
  industry?: string;
  primaryLanguage?: string;
  description?: string;
}

export interface UpdateWebsiteInput {
  name?: string;
  url?: string;
  industry?: string;
  primaryLanguage?: string;
  description?: string;
}

export async function listWebsites(organizationId: string) {
  return repo.listWebsites(organizationId);
}

export async function getWebsite(organizationId: string, websiteId: string) {
  return repo.getWebsite(organizationId, websiteId);
}

export async function createWebsite(organizationId: string, userId: string, input: CreateWebsiteInput) {
  const website = await repo.createWebsite(organizationId, input);
  await writeAuditLog({
    action: 'website.created',
    organizationId,
    userId,
    targetType: 'website',
    targetId: website.id,
    metadata: { name: website.name, url: website.url },
  });
  return website;
}

export async function updateWebsite(
  organizationId: string,
  userId: string,
  websiteId: string,
  input: UpdateWebsiteInput,
) {
  const result = await repo.updateWebsite(organizationId, websiteId, input);
  if (result.count > 0) {
    await writeAuditLog({
      action: 'website.updated',
      organizationId,
      userId,
      targetType: 'website',
      targetId: websiteId,
    });
  }
  return result;
}

export async function deleteWebsite(organizationId: string, userId: string, websiteId: string) {
  const result = await repo.softDeleteWebsite(organizationId, websiteId);
  if (result.count > 0) {
    await writeAuditLog({
      action: 'website.deleted',
      organizationId,
      userId,
      targetType: 'website',
      targetId: websiteId,
    });
  }
  return result;
}

/**
 * Assert that a website belongs to the given org. Throws 404 if not found or
 * 403 if found but owned by a different org (never leaking cross-tenant existence).
 */
export async function assertWebsiteOwnership(organizationId: string, websiteId: string): Promise<void> {
  const website = await repo.getWebsite(organizationId, websiteId);
  if (!website) throw new OwnershipError('website_not_found', 'Website not found.', 404);
}

export class OwnershipError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
    this.name = 'OwnershipError';
  }
}
