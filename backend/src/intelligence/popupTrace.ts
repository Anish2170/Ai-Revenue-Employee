import { config } from '../config/index.js';
import { logger } from '../logging/logger.js';
import { safeIdentifier } from '../logging/sanitize.js';

export interface PopupTraceDetail {
  passed?: boolean;
  reason?: string | null;
  [key: string]: unknown;
}

export function popupTrace(sessionId: string, stage: string, detail: PopupTraceDetail = {}): void {
  if (!config.debugTrace) return;
  logger.debug(`[popup-trace:${safeIdentifier(sessionId)}] stage=${stage}`, detail);
}

export function cooldownRemainingMs(lastInterruptionTs: number | null, now: number, cooldownMs: number): number {
  if (lastInterruptionTs === null) return 0;
  return Math.max(0, cooldownMs - Math.max(0, now - lastInterruptionTs));
}

