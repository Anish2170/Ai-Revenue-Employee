import { AsyncLocalStorage } from 'node:async_hooks';
import type { StructuredRequest } from '../llm/provider/types.js';
import { appendTrace, reserveCall } from './service.js';
import { REPLAY, reserveQuote } from './policy.js';

export interface ReplayContext { runId: string; batchId: string; siteId: string; runnerId: string }
export const replayScope = new AsyncLocalStorage<ReplayContext>();
export const currentReplay = () => replayScope.getStore();
export async function traceReplay(event: Record<string, unknown>): Promise<void> {
  const context = currentReplay();
  if (context) await appendTrace(context.runId, event);
}
export function traceReplaySoon(event: Record<string, unknown>): void {
  void traceReplay(event).catch(() => console.warn('[popup-replay] Trace persistence unavailable.'));
}
export async function reserveReplayExternal(kind: 'generation' | 'embedding', model: string, text: string) {
  const context = currentReplay();
  if (context) await reserveCall(context.runId, reserveQuote(kind, model, Buffer.byteLength(text, 'utf8')), { callKind: kind, model });
}
export async function replayStructured<T>(providerId: string, req: StructuredRequest, invoke: (value: StructuredRequest) => Promise<T>): Promise<T> {
  if (!currentReplay()) return invoke(req);
  const model = providerId.replace(/^[^:]+:/, '');
  await reserveReplayExternal('generation', model, req.system + req.user);
  return invoke({ ...req, maxOutputTokens: Math.min(req.maxOutputTokens ?? REPLAY.maxOutputTokens, REPLAY.maxOutputTokens), onUsage: usage => { req.onUsage?.(usage); traceReplaySoon({ kind: 'usage', ...usage }); } });
}
