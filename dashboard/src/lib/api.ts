function getBaseUrl() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787`;
  }
  return 'http://localhost:8787';
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (Array.isArray(body.details) && body.details.length > 0) {
        message = body.details
          .map((detail: { path?: string; message?: string }) => {
            const field = detail.path ? `${detail.path}: ` : '';
            return `${field}${detail.message || 'Invalid value'}`;
          })
          .join('; ');
      } else {
        message = body.message || body.error || message;
      }
    } catch {
      // ignore non-JSON error bodies
    }
    throw new ApiError(res.status, message);
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
  signup(email: string, password: string, name: string, organizationName?: string) {
    return request('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, organizationName }),
    });
  }

  login(email: string, password: string) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  }

  logout() {
    return request('/auth/logout', { method: 'POST' });
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
    const res = await fetch(`${getBaseUrl()}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        visitorId: 'owner-onboarding',
        sessionId: `onboarding-${Date.now()}`,
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new ApiError(res.status, res.statusText);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';

          for (const frame of frames) {
            const lines = frame.split('\n');
            let event = 'message';
            let data = '';

            for (const line of lines) {
              if (line.startsWith('event:')) {
                event = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                data += line.slice(5).trim();
              }
            }

            if (!data) continue;

            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }

            if (event === 'complete' || event.endsWith(':complete')) {
              completeCb?.(parsed);
            } else if (event === 'error' || event.endsWith(':error')) {
              const message =
                typeof parsed === 'string'
                  ? parsed
                  : parsed && typeof parsed === 'object' && 'error' in parsed
                    ? String((parsed as { error?: unknown }).error)
                    : JSON.stringify(parsed);
              errorCb?.(new Error(message));
            } else {
              phaseCb?.(event, parsed);
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        errorCb?.(err instanceof Error ? err : new Error(String(err)));
      }
    }

    return handle;
  }
}

export const api = new ApiClient();




