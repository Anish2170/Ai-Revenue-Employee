/**
 * Business instructions service — DB-backed replacement for business-instructions.json.
 * 1:1 with Website; auto-created with sensible defaults on first access.
 */
import { prisma } from '../db/prisma.js';
import { assertWebsiteOwnership } from '../websites/website.service.js';
import { writeAuditLog } from '../audit/audit.service.js';

export interface BusinessInstructionData {
  businessName?: string;
  companyDescription?: string;
  role?: string;
  tone?: string;
  goal?: string;
  context?: string;
  rules?: string;
  fallbackMessage?: string;
  language?: string;
  alwaysBookDemo?: boolean;
  avoidDiscounts?: boolean;
  allowedLinks?: Array<{ label: string; url: string }>;
  preferredCta?: string;
  supportEmail?: string;
  supportPhone?: string;
  websiteUrl?: string;
}

const DEFAULT_TONE = 'Professional, helpful, and concise.';
const DEFAULT_LANGUAGE = 'English';

export async function getOrCreateInstructions(organizationId: string, websiteId: string) {
  await assertWebsiteOwnership(organizationId, websiteId);
  let instruction = await prisma.businessInstruction.findUnique({ where: { websiteId } });
  if (!instruction) {
    const website = await prisma.website.findUnique({ where: { id: websiteId } });
    instruction = await prisma.businessInstruction.create({
      data: {
        websiteId,
        businessName: website?.name ?? 'Your Business',
        tone: DEFAULT_TONE,
        language: website?.primaryLanguage ?? DEFAULT_LANGUAGE,
        websiteUrl: website?.url,
      },
    });
  }
  return instruction;
}

export async function updateInstructions(
  organizationId: string,
  userId: string,
  websiteId: string,
  data: BusinessInstructionData,
) {
  await assertWebsiteOwnership(organizationId, websiteId);
  const updated = await prisma.businessInstruction.upsert({
    where: { websiteId },
    create: {
      websiteId,
      businessName: data.businessName ?? 'Your Business',
      companyDescription: data.companyDescription,
      role: data.role,
      tone: data.tone ?? DEFAULT_TONE,
      goal: data.goal,
      context: data.context,
      rules: data.rules,
      fallbackMessage: data.fallbackMessage,
      language: data.language ?? DEFAULT_LANGUAGE,
      alwaysBookDemo: data.alwaysBookDemo ?? false,
      avoidDiscounts: data.avoidDiscounts ?? false,
      allowedLinks: (data.allowedLinks ?? []) as object,
      preferredCta: data.preferredCta,
      supportEmail: data.supportEmail,
      supportPhone: data.supportPhone,
      websiteUrl: data.websiteUrl,
    },
    update: {
      ...(data.businessName !== undefined && { businessName: data.businessName }),
      ...(data.companyDescription !== undefined && { companyDescription: data.companyDescription }),
      ...(data.role !== undefined && { role: data.role }),
      ...(data.tone !== undefined && { tone: data.tone }),
      ...(data.goal !== undefined && { goal: data.goal }),
      ...(data.context !== undefined && { context: data.context }),
      ...(data.rules !== undefined && { rules: data.rules }),
      ...(data.fallbackMessage !== undefined && { fallbackMessage: data.fallbackMessage }),
      ...(data.language !== undefined && { language: data.language }),
      ...(data.alwaysBookDemo !== undefined && { alwaysBookDemo: data.alwaysBookDemo }),
      ...(data.avoidDiscounts !== undefined && { avoidDiscounts: data.avoidDiscounts }),
      ...(data.allowedLinks !== undefined && { allowedLinks: data.allowedLinks as object }),
      ...(data.preferredCta !== undefined && { preferredCta: data.preferredCta }),
      ...(data.supportEmail !== undefined && { supportEmail: data.supportEmail }),
      ...(data.supportPhone !== undefined && { supportPhone: data.supportPhone }),
      ...(data.websiteUrl !== undefined && { websiteUrl: data.websiteUrl }),
    },
  });
  await writeAuditLog({
    action: 'instructions.updated',
    organizationId,
    userId,
    targetType: 'website',
    targetId: websiteId,
  });
  return updated;
}
