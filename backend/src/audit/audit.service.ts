/**
 * Audit log helper. Fire-and-forget: recording an audit event must never break
 * the primary action, so failures are swallowed (logged to console only).
 */
import { prisma } from '../db/prisma.js';

export interface AuditEvent {
  action: string; // e.g. "user.signup", "website.created", "knowledge.built"
  organizationId?: string | null;
  userId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

export async function writeAuditLog(event: AuditEvent): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: event.action,
        organizationId: event.organizationId ?? null,
        userId: event.userId ?? null,
        targetType: event.targetType,
        targetId: event.targetId,
        metadata: (event.metadata ?? {}) as object,
        ip: event.ip,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write log:', err instanceof Error ? err.message : err);
  }
}
