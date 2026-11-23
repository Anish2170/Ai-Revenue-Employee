export type ReplayRunner = { id: string; name: string; online: boolean; lastSeenAt: string | null; revoked: boolean; expiresAt: string };
export type ReplayTrace = { kind: string; at?: string; reason?: string; blockedReason?: string; confidence?: number; strategy?: string; popupType?: string; model?: string; reservedMicros?: number; validationPassed?: boolean; [key: string]: unknown };
export type ReplayResult = { outcome: string; reason?: string; serverDisplayConfirmed?: boolean; hasScreenshot?: boolean; popup?: { title: string; body: string; type: string; cta: string; destination?: string }; steps?: { action: string; path?: string; atMs: number }[] };
export type ReplayRun = { id: string; ordinal: number; scenario: string; status: string; externalCalls: number; visitorId: string | null; sessionId: string | null; trace: ReplayTrace[]; result: ReplayResult | null; rating: string | null };
export type ReplayBatch = { id: string; websiteId: string; runnerId: string; status: string; budgetMicros: number; reservedMicros: number; externalCalls: number; createdAt: string; config: { count: number; surface: string; pilotRuns: number; scenarios: string[] }; runs?: ReplayRun[] };
export type ReplayInventory = { runners: ReplayRunner[]; batches: ReplayBatch[]; scenarios: string[] };
export const scenarioLabels: Record<string, string> = { pricing: 'Fees and pricing revisit', research: 'Explore services', comparison: 'Compare programs or services', trust: 'Reviews, team and FAQs', form_pause: 'Pause in a form', chat_open: 'Keep chat open (expect silence)', typing: 'Type in a form (expect silence)', hidden: 'Hide the tab (expect silence)' };
export function replaySummary(runs: ReplayRun[]) {
  const types: Record<string, number> = {}, bodies = new Map<string, number>();
  let displayed = 0, suppressed = 0, failed = 0;
  for (const run of runs) {
    if (run.status === 'DISPLAYED') displayed++;
    if (run.status === 'SUPPRESSED') suppressed++;
    if (['FAILED', 'UNEXPECTED_POPUP'].includes(run.status)) failed++;
    if (run.result?.popup && ['DISPLAYED', 'UNEXPECTED_POPUP'].includes(run.status)) {
      const p = run.result.popup; types[p.type] = (types[p.type] ?? 0) + 1;
      const body = p.body.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); bodies.set(body, (bodies.get(body) ?? 0) + 1);
    }
  }
  return { displayed, suppressed, failed, types, repeatedCopies: [...bodies.values()].reduce((total, count) => total + Math.max(0, count - 1), 0) };
}
