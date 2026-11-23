export const REPLAY = {
  maxRuns: 50, pilotRuns: 5, maxBudgetMicros: 1_000_000, leaseMs: 180_000,
  maxCallsPerRun: 4, maxCallsPerBatch: 200, maxOutputTokens: 512,
  maxInputBytes: 60_000, maxScreenshotBytes: 400_000, retentionMs: 7 * 86400_000,
} as const;
export const SCENARIOS = ['pricing', 'research', 'comparison', 'trust', 'form_pause', 'chat_open', 'typing', 'hidden'] as const;
export type ReplayScenario = typeof SCENARIOS[number];
export const SILENCE_SCENARIOS = new Set<string>(['chat_open', 'typing', 'hidden']);
export const hashableTokenPattern = /^[A-Za-z0-9_-]{43}$/;
export function classifyReplayOutcome(scenario: string, outcome: string, displayed: boolean, expectedBlock: boolean, copyMatches: boolean, hasSignals: boolean): string {
  if (displayed && SILENCE_SCENARIOS.has(scenario)) return 'UNEXPECTED_POPUP';
  if (displayed) return outcome === 'displayed' && copyMatches ? 'DISPLAYED' : 'FAILED';
  if (outcome !== 'silent') return 'FAILED';
  return SILENCE_SCENARIOS.has(scenario) ? expectedBlock ? 'SUPPRESSED' : 'FAILED' : hasSignals ? 'SUPPRESSED' : 'FAILED';
}

/** Deliberately conservative ceilings, not a claim about a provider's invoice.
 * Unknown models fail closed until their ceiling is reviewed. Reserve failures
 * too: a timeout may have consumed provider resources. */
export function reserveQuote(kind: 'generation' | 'embedding', model: string, bytes: number): number {
  const known = kind === 'generation' ? /^(gpt-6-luna|gemini-3\.5-flash-lite)(?:-|$)/.test(model) : model === 'gemini-embedding-001';
  if (!known || bytes > REPLAY.maxInputBytes || bytes < 0) throw new Error('Replay model or input exceeds the reviewed cost envelope.');
  // One token per UTF-8 byte is a conservative input bound. $1/M input,
  // $10/M output ceilings exceed the reviewed supported-model rates.
  return Math.ceil(bytes + (kind === 'generation' ? REPLAY.maxOutputTokens * 10 : 0));
}

export function buildRunPlan(scenarios: readonly ReplayScenario[], count: number, surface: 'desktop' | 'mobile') {
  if (!scenarios.length || scenarios.some(s => !SCENARIOS.includes(s)) || !Number.isInteger(count) || count < 1 || count > REPLAY.maxRuns) throw Error('Invalid replay plan.');
  return Array.from({ length: count }, (_, index) => ({ ordinal: index + 1, scenario: scenarios[index % scenarios.length], surface }));
}

export function safeWebsiteUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|:|\.local$/i.test(url.hostname)) throw Error('Replay requires a public HTTPS website.');
  return url;
}
