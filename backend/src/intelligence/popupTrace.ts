import { config } from '../config/index.js';

export interface PopupTraceDetail {
  passed?: boolean;
  reason?: string | null;
  [key: string]: unknown;
}

export function popupTrace(sessionId: string, stage: string, detail: PopupTraceDetail = {}): void {
  if (!config.debugTrace) return;
  const safeDetail = JSON.stringify(detail, (_key, value) => {
    if (value instanceof Set) return Array.from(value);
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return value;
  });
  console.log(`[popup-trace:${sessionId.slice(0, 8)}] stage=${stage} ${safeDetail}`);
}

export function cooldownRemainingMs(lastInterruptionTs: number | null, now: number, cooldownMs: number): number {
  if (lastInterruptionTs === null) return 0;
  return Math.max(0, cooldownMs - Math.max(0, now - lastInterruptionTs));
}

