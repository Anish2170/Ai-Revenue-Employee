import { LLMTimeoutError } from './provider/errors.js';

/** One deadline/signal across awaits. Also rejects providers that ignore abort. */
export function deadlineScope(parent?: AbortSignal, timeoutMs?: number) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? new Error('Request cancelled'));
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  if (timeoutMs !== undefined && timeoutMs <= 0) controller.abort(new LLMTimeoutError('Popup deadline timed out.'));
  const timer = timeoutMs === undefined || timeoutMs <= 0 ? null : setTimeout(() => controller.abort(new LLMTimeoutError('Popup deadline timed out.')), timeoutMs);
  return {
    signal: controller.signal,
    close() { if (timer !== null) clearTimeout(timer); parent?.removeEventListener('abort', abort); },
  };
}

export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error('Request cancelled'));
    // Observe work even when the parent was already aborted (no late rejection leak).
    work.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Request cancelled');
}
