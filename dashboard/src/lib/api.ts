const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
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
      message = body.message || body.error || message;
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

  getWidget(websiteId: string) {
    return request(`/api/websites/${websiteId}/widget`);
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
        const res = await fetch(`${BASE_URL}/api/websites/${websiteId}/knowledge/build`, {
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

            if (event === 'complete') {
              completeCb?.(parsed);
            } else if (event === 'error') {
              errorCb?.(new Error(typeof parsed === 'string' ? parsed : JSON.stringify(parsed)));
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
