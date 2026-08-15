export type LLMFailureCategory = 'timeout' | 'connection' | 'unavailable' | 'rate_limit' | 'server' | 'input' | 'auth' | 'safety' | 'unknown';

export function failureCategory(error: unknown): LLMFailureCategory {
  const item = error as { status?: number; code?: string; name?: string; message?: string } | undefined;
  const status = item?.status;
  const text = `${item?.name ?? ''} ${item?.code ?? ''} ${item?.message ?? ''}`.toLowerCase();
  if (status === 400 || status === 404 || status === 422 || /invalid request|malformed/.test(text)) return 'input';
  if (status === 401 || status === 403 || /api key|authentication|unauthorized|forbidden/.test(text)) return 'auth';
  if (status === 429 || /rate limit|quota|resource exhausted/.test(text)) return 'rate_limit';
  if (status === 408 || status === 504 || /timeout|timed out|abort/.test(text)) return 'timeout';
  if (status === 503 || /overloaded|unavailable/.test(text)) return 'unavailable';
  if (status !== undefined && status >= 500) return 'server';
  if (/network|fetch failed|econnreset|enotfound|connection/.test(text)) return 'connection';
  if (/safety|blocked/.test(text)) return 'safety';
  return 'unknown';
}

export function isRetryable(error: unknown): boolean {
  return ['timeout', 'connection', 'unavailable', 'rate_limit', 'server'].includes(failureCategory(error));
}

export class LLMTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = 'LLMTimeoutError'; }
}
