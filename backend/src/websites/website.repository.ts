/**
 * Website repository — the org-scoped data-access layer.
 *
 * EVERY function requires an `organizationId`. This is the isolation boundary:
 * a caller physically cannot read or mutate a website without naming the org,
 * and mismatched org+id simply returns null (never another tenant's row).
 */
import { prisma } from '../db/prisma.js';
import type { Prisma } from '@prisma/client';

export function listWebsites(organizationId: string) {
  return prisma.website.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

export function getWebsite(organizationId: string, websiteId: string) {
  return prisma.website.findFirst({
    where: { id: websiteId, organizationId, deletedAt: null },
  });
}

export function createWebsite(organizationId: string, data: Prisma.WebsiteCreateWithoutOrganizationInput) {
  return prisma.website.create({
    data: { ...data, organization: { connect: { id: organizationId } } },
  });
}

export function updateWebsite(
  organizationId: string,
  websiteId: string,
  data: Prisma.WebsiteUpdateInput,
) {
  // updateMany enforces the org scope in the WHERE clause.
  return prisma.website.updateMany({ where: { id: websiteId, organizationId, deletedAt: null }, data });
}

export function softDeleteWebsite(organizationId: string, websiteId: string) {
  return prisma.website.updateMany({
    where: { id: websiteId, organizationId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
}
