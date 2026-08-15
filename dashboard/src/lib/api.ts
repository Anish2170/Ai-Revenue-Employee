function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return 'http://localhost:8787';
}

export class ApiError extends Error {
  status: number;
  code?: string;
  requestId?: string;
  retryAfterSeconds?: number;

  constructor(status: number, message: string, options: { code?: string; requestId?: string; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) {
    const reference = error.requestId ? ` Reference: ${error.requestId}` : '';
    if (error.status === 403) return `You don't have permission to access this section.${reference}`;
    if (error.status === 404) return `The requested resource was not found.${reference}`;
    if (error.status === 409) return `This action is already in progress or conflicts with an existing change.${reference}`;
    if (error.status === 429) return `You're doing that a little too quickly. Please try again${error.retryAfterSeconds ? ` in ${error.retryAfterSeconds} seconds` : ' in a moment'}.${reference}`;
    if (error.status >= 500) return `Something went wrong on our side. Try again.${reference}`;
    return `${error.message}${reference}`;
  }
  return error instanceof Error && error.name === 'AbortError' ? 'The request took too long. Please try again.' : fallback;
}

let csrfToken: string | undefined;
let csrfTokenRequest: Promise<string> | undefined;

function needsCsrf(path: string, method: string | undefined): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes((method ?? 'GET').toUpperCase())
    && !['/auth/signup', '/auth/login', '/auth/forgot', '/auth/reset'].includes(path);
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfTokenRequest ??= fetch(`${getBaseUrl()}/auth/csrf`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'Unable to establish CSRF protection.');
      const body = await res.json() as { csrfToken?: string };
      if (!body.csrfToken) throw new Error('CSRF token missing from server response.');
      csrfToken = body.csrfToken;
      return csrfToken;
    })
    .finally(() => { csrfTokenRequest = undefined; });
  return csrfTokenRequest;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  if (needsCsrf(path, options.method)) headers.set('X-CSRF-Token', await getCsrfToken());
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${getBaseUrl()}${path}`, { credentials: 'include', headers, ...options, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new ApiError(0, 'The request took too long. Please try again.', { code: 'timeout' });
    throw new ApiError(0, 'Unable to connect. Check your connection and try again.', { code: 'network_error' });
  } finally {
    window.clearTimeout(timeout);
  }

  if (!res.ok) {
    let message = res.statusText || 'Request failed.';
    let code: string | undefined;
    let requestId = res.headers.get('X-Request-Id') ?? undefined;
    let retryAfterSeconds = Number(res.headers.get('Retry-After')) || undefined;
    try {
      const body = await res.json() as { error?: string | { code?: string; message?: string; requestId?: string }; message?: string; details?: Array<{ path?: string; message?: string }>; retryAfterSeconds?: number };
      if (Array.isArray(body.details) && body.details.length > 0) {
        message = body.details
          .map((detail: { path?: string; message?: string }) => {
            const field = detail.path ? `${detail.path}: ` : '';
            return `${field}${detail.message || 'Invalid value'}`;
          })
          .join('; ');
      } else {
        if (typeof body.error === 'object') {
          code = body.error.code;
          message = body.error.message || message;
          requestId = body.error.requestId || requestId;
        } else {
          code = body.error;
          message = body.message || body.error || message;
        }
        retryAfterSeconds = body.retryAfterSeconds || retryAfterSeconds;
      }
    } catch {
      // ignore non-JSON error bodies
    }
    const error = new ApiError(res.status, message, { code, requestId, retryAfterSeconds });
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/signup')) {
      csrfToken = undefined;
      window.dispatchEvent(new CustomEvent('aire:unauthenticated'));
    }
    throw error;
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export interface KnowledgeBuildHandle {
  onPhase: (cb: (phase: string, data?: unknown) => void) => KnowledgeBuildHandle;
  onComplete: (cb: (data?: unknown) => void) => KnowledgeBuildHandle;
  onError: (cb: (error: Error) => void) => KnowledgeBuildHandle;
  start: () => void;
  abort: () => void;
}

class ApiClient {
  async signup(email: string, password: string, name: string, organizationName?: string) {
    const result = await request<{ csrfToken?: string }>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, organizationName }),
    });
    csrfToken = result.csrfToken;
    return result;
  }

  async login(email: string, password: string) {
    const result = await request<{ csrfToken?: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    csrfToken = result.csrfToken;
    return result;
  }

  async logout() {
    const result = await request('/auth/logout', { method: 'POST' });
    csrfToken = undefined;
    return result;
  }

  me() {
    return request('/auth/me');
  }

  listWebsites() {
    return request('/api/websites');
  }

  getAnalyticsSummary(websiteId?: string) {
    const qs = websiteId ? '?websiteId=' + encodeURIComponent(websiteId) : '';
    return request('/api/analytics/summary' + qs);
  }

  getAnalyticsChart(metric: string, days = 14, websiteId?: string) {
    const params = new URLSearchParams({ metric, days: String(days) });
    if (websiteId) params.set('websiteId', websiteId);
    return request('/api/analytics/charts?' + params.toString());
  }


  getAiDecisionLog(filters: { websiteId?: string; decision?: string; popupType?: string; sessionId?: string; date?: string; startDate?: string; endDate?: string; search?: string; limit?: number; export?: boolean } = {}) {
    const params = new URLSearchParams();
    if (filters.websiteId) params.set('websiteId', filters.websiteId);
    if (filters.decision) params.set('decision', filters.decision);
    if (filters.popupType) params.set('popupType', filters.popupType);
    if (filters.sessionId) params.set('sessionId', filters.sessionId);
    if (filters.date) params.set('date', filters.date);
    if (filters.startDate) params.set('startDate', filters.startDate);
    if (filters.endDate) params.set('endDate', filters.endDate);
    if (filters.search) params.set('search', filters.search);
    if (filters.limit) params.set('limit', String(filters.limit));
    if (filters.export) params.set('export', '1');
    const qs = params.toString();
    return request('/api/analytics/decision-log' + (qs ? '?' + qs : ''));
  }


  listLeads(websiteId?: string) {
    const qs = websiteId ? '?websiteId=' + encodeURIComponent(websiteId) : '';
    return request('/api/leads' + qs);
  }
  listConversations(websiteId?: string) {
    const qs = websiteId ? '?websiteId=' + encodeURIComponent(websiteId) : '';
    return request('/api/conversations' + qs);
  }

  getConversation(id: string) {
    return request(`/api/conversations/${id}`);
  }

  renameConversation(id: string, title: string) {
    return request(`/api/conversations/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }
  createWebsite(data: unknown) {
    return request('/api/websites', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  getWebsite(id: string) {
    return request(`/api/websites/${id}`);
  }

  updateWebsite(id: string, data: unknown) {
    return request(`/api/websites/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  deleteWebsite(id: string) {
    return request(`/api/websites/${id}`, { method: 'DELETE' });
  }

  getInstructions(websiteId: string) {
    return request(`/api/websites/${websiteId}/instructions`);
  }

  updateInstructions(websiteId: string, data: unknown) {
    return request(`/api/websites/${websiteId}/instructions`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }


  getDiscoveredWebsiteActions(websiteId: string) {
    return request(`/api/websites/${websiteId}/actions/discovered`);
  }

  updateDiscoveredActionUrlOverride(websiteId: string, intent: string, url: string) {
    return request(`/api/websites/${websiteId}/actions/discovered/${intent}/override`, {
      method: 'PUT',
      body: JSON.stringify({ url }),
    });
  }

  clearDiscoveredActionUrlOverride(websiteId: string, intent: string) {
    return request(`/api/websites/${websiteId}/actions/discovered/${intent}/override`, { method: 'DELETE' });
  }

  listBusinessActions(websiteId: string) {
    return request(`/api/websites/${websiteId}/actions`);
  }

  createBusinessAction(websiteId: string, data: unknown) {
    return request(`/api/websites/${websiteId}/actions`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  updateBusinessAction(websiteId: string, actionId: string, data: unknown) {
    return request(`/api/websites/${websiteId}/actions/${actionId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  deleteBusinessAction(websiteId: string, actionId: string) {
    return request(`/api/websites/${websiteId}/actions/${actionId}`, { method: 'DELETE' });
  }
  getWidget(websiteId: string) {
    return request(`/api/websites/${websiteId}/widget`);
  }

  verifyWidgetInstallation(websiteId: string) {
    return request(`/api/websites/${websiteId}/widget/verify`, { method: 'POST' });
  }

  async sendTestChat(siteId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>) {
    const identityResponse = await fetch(`${getBaseUrl()}/widget/session`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteId }),
    });
    if (!identityResponse.ok) throw await responseError(identityResponse);
    const identity = await identityResponse.json() as {
      visitorId?: string;
      sessionId?: string;
      visitorToken?: string;
    };
    if (!identity.visitorId || !identity.sessionId || !identity.visitorToken) {
      throw new ApiError(502, 'Unable to establish a widget test session.');
    }

    const res = await fetch(`${getBaseUrl()}/chat`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        visitorId: identity.visitorId,
        sessionId: identity.sessionId,
        visitorToken: identity.visitorToken,
        messages,
        behaviour: {
          page: '/onboarding-test',
          pageTitle: 'Owner onboarding test chat',
          timeOnPage: 0,
          scrollDepth: 0,
          mouseInactive: 0,
          clickedElements: [],
          formInteracted: false,
          viewport: { width: 1280, height: 800 },
          exitIntent: false,
        },
      }),
    });

    if (!res.ok || !res.body) {
      throw new ApiError(res.status, res.statusText || 'Failed to send test message');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reply = '';
    let error = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string };
            if (parsed.token) reply += parsed.token;
            if (parsed.error) error = parsed.error;
          } catch {
            // Ignore malformed stream frames.
          }
        }
      }
    }

    if (error) throw new Error(error);
    return { reply };
  }

  getKnowledgeDebugOverview(websiteId: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/overview`);
  }

  getKnowledgeDebugPages(websiteId: string, page = 1, limit = 20) {
    return request(`/api/websites/${websiteId}/knowledge/debug/pages?page=${page}&limit=${limit}`);
  }

  getKnowledgeDebugPageDetail(websiteId: string, url: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/pages/detail?url=${encodeURIComponent(url)}`);
  }

  getKnowledgeDebugChunks(websiteId: string, page = 1, limit = 20, pageUrl?: string) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (pageUrl) params.set('pageUrl', pageUrl);
    return request(`/api/websites/${websiteId}/knowledge/debug/chunks?${params.toString()}`);
  }

  getKnowledgeDebugChunkDetail(websiteId: string, chunkId: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/chunks/${encodeURIComponent(chunkId)}`);
  }

  runKnowledgeDebugSearch(websiteId: string, question: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/search-test`, {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  }

  getKnowledgeDebugActions(websiteId: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/actions`);
  }

  getKnowledgeDebugQualityChecks(websiteId: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/quality-checks`);
  }

  getKnowledgeDebugVisualFlow(websiteId: string) {
    return request(`/api/websites/${websiteId}/knowledge/debug/visual-flow`);
  }
  getKnowledgeStatus(websiteId: string) {
    return request(`/api/websites/${websiteId}/knowledge/status`);
  }

  getKnowledgeBuilds(websiteId: string) {
    return request(`/api/websites/${websiteId}/knowledge/builds`);
  }

  getKnowledgeBuild(websiteId: string, buildId: string) {
    return request(`/api/websites/${websiteId}/knowledge/build/${buildId}`);
  }

  buildKnowledge(websiteId: string, url: string): KnowledgeBuildHandle {
    let phaseCb: ((phase: string, data?: unknown) => void) | undefined;
    let completeCb: ((data?: unknown) => void) | undefined;
    let errorCb: ((error: Error) => void) | undefined;
    const controller = new AbortController();

    const handle: KnowledgeBuildHandle = {
      onPhase(cb) {
        phaseCb = cb;
        return handle;
      },
      onComplete(cb) {
        completeCb = cb;
        return handle;
      },
      onError(cb) {
        errorCb = cb;
        return handle;
      },
      start() {
        run();
      },
      abort() {
        controller.abort();
      },
    };

    async function run() {
      try {
        const res = await fetch(`${getBaseUrl()}/api/websites/${websiteId}/knowledge/build`, {
          method: 'POST',
          credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': await getCsrfToken() },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });

        if (!res.ok) throw await responseError(res);
        const queued = await res.json() as { buildId: string };
        let lastPhase = '';
        let transientFailures = 0;
        const poll = async (): Promise<void> => {
          if (controller.signal.aborted) return;
          let build: { status?: string; phase?: string; error?: string; progress?: unknown };
          try {
            build = await request(`/api/websites/${websiteId}/knowledge/build/${queued.buildId}`) as typeof build;
            transientFailures = 0;
          } catch (error) {
            if (error instanceof ApiError && (error.status === 0 || error.status === 502 || error.status === 503) && transientFailures < 3) {
              transientFailures += 1;
              phaseCb?.('connection_lost', { attempt: transientFailures });
              window.setTimeout(() => { void poll(); }, 1500 * transientFailures);
              return;
            }
            throw error;
          }
          if (build.phase && build.phase !== lastPhase) { lastPhase = build.phase; phaseCb?.(build.phase, build.progress); }
          if (build.status === 'SUCCESS') { completeCb?.(build); return; }
          if (build.status === 'FAILED' || build.status === 'CANCELLED') { errorCb?.(new Error('Knowledge build failed. Please try again.')); return; }
          window.setTimeout(() => { void poll().catch((err) => errorCb?.(err instanceof Error ? err : new Error(String(err)))); }, 1500);
        };
        await poll();
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        errorCb?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    return handle;
  }
}

async function responseError(res: Response): Promise<ApiError> {
  let message = res.statusText || 'Request failed.';
  let code: string | undefined;
  let requestId = res.headers.get('X-Request-Id') ?? undefined;
  let retryAfterSeconds = Number(res.headers.get('Retry-After')) || undefined;
  try {
    const body = await res.json() as { error?: string | { code?: string; message?: string; requestId?: string }; message?: string; retryAfterSeconds?: number };
    if (typeof body.error === 'object') { code = body.error.code; message = body.error.message || message; requestId = body.error.requestId || requestId; }
    else { code = body.error; message = body.message || body.error || message; }
    retryAfterSeconds = body.retryAfterSeconds || retryAfterSeconds;
  } catch { /* use the safe status text */ }
  return new ApiError(res.status, message, { code, requestId, retryAfterSeconds });
}

export const api = new ApiClient();




