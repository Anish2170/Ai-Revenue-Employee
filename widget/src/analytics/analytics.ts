import type { WidgetConfig } from '../types.js';
import { resolveReturning } from '../sensors/session.js';
import type { WidgetIdentity } from '../api/client.js';

type AnalyticsCategory = 'VISITOR' | 'PAGE' | 'POPUP' | 'CHAT' | 'KNOWLEDGE' | 'WIDGET';

interface AnalyticsEvent {
  eventId: string;
  category: AnalyticsCategory;
  eventName: string;
  occurredAt: string;
  pageUrl?: string;
  pagePath?: string;
  pageTitle?: string;
  referrer?: string;
  device?: string;
  browser?: string;
  surface?: string;
  popupType?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  durationMs?: number;
  numericValue?: number;
  reason?: string;
  label?: string;
  actionId?: string;
}

export interface TrackOptions extends Partial<Omit<AnalyticsEvent, 'category' | 'eventName' | 'occurredAt'>> {
  flush?: boolean;
}

const FLUSH_MS = 5000;
const MAX_BUFFER = 50;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1500];
const REQUEST_TIMEOUT_MS = 5000;

export class AnalyticsTracker {
  private readonly visitorId: string;
  private readonly sessionId: string;
  private readonly visitorToken: string;
  private readonly returning = resolveReturning();
  private readonly device = detectDevice();
  private readonly browser = detectBrowser();
  private readonly surface = detectSurface();
  private readonly sessionStartedAt = Date.now();
  private pageStartedAt = Date.now();
  private pageKey = this.currentPageKey();
  private buffer: AnalyticsEvent[] = [];
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private sessionEnded = false;

  constructor(private readonly cfg: WidgetConfig, identity: WidgetIdentity) {
    this.visitorId = identity.visitorId;
    this.sessionId = identity.sessionId;
    this.visitorToken = identity.visitorToken;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), FLUSH_MS);
    window.addEventListener('pagehide', this.endSession, { capture: true });
    document.addEventListener('visibilitychange', this.onVisibility, { capture: true });
    window.addEventListener('popstate', this.onNavigation, { capture: true });
    this.patchHistory('pushState');
    this.patchHistory('replaceState');

    this.track('WIDGET', 'widget_loaded');
    this.track('VISITOR', 'visitor_started');
    if (this.returning) this.track('VISITOR', 'returning_visitor');
    this.track('VISITOR', 'session_started');
    this.track('PAGE', 'page_viewed', { flush: true });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('pagehide', this.endSession, { capture: true } as EventListenerOptions);
    document.removeEventListener('visibilitychange', this.onVisibility, { capture: true } as EventListenerOptions);
    window.removeEventListener('popstate', this.onNavigation, { capture: true } as EventListenerOptions);
    this.endSession();
  }

  track(category: AnalyticsCategory, eventName: string, opts: TrackOptions = {}): void {
    if (this.stopped && eventName !== 'session_ended') return;
    const event: AnalyticsEvent = {
      eventId: createEventId(),
      category,
      eventName,
      occurredAt: new Date().toISOString(),
      ...this.pageContext(),
      device: this.device,
      browser: this.browser,
      surface: this.surface,
      ...stripFlush(opts),
    };
    this.buffer.push(event);
    if (opts.flush || this.buffer.length >= MAX_BUFFER) this.flush();
  }

  private trackPageEnd(): void {
    this.track('PAGE', 'page_exited', { durationMs: Date.now() - this.pageStartedAt, flush: true });
  }

  private endSession = (): void => {
    if (this.sessionEnded) {
      this.flush(true);
      return;
    }
    this.sessionEnded = true;
    this.trackPageEnd();
    this.track('VISITOR', 'session_ended', { durationMs: Date.now() - this.sessionStartedAt, flush: true });
    this.flush(true);
  };

  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.endSession();
  };

  private onNavigation = (): void => {
    setTimeout(() => {
      const next = this.currentPageKey();
      if (next === this.pageKey) return;
      this.trackPageEnd();
      this.pageStartedAt = Date.now();
      this.pageKey = next;
      this.track('PAGE', 'page_viewed', { flush: true });
    }, 0);
  };

  private patchHistory(method: 'pushState' | 'replaceState'): void {
    const historyWithFlag = history as History & Record<string, boolean>;
    const flag = `__aireAnalytics_${method}`;
    if (historyWithFlag[flag]) return;
    historyWithFlag[flag] = true;
    const original = history[method];
    const tracker = this;
    history[method] = function patchedHistory(this: History, ...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      tracker.onNavigation();
      return result;
    } as History[typeof method];
  }

  private flush(useBeacon = false): void {
    if (this.buffer.length === 0 || this.flushing) return;
    if (useBeacon) {
      const events = this.buffer.splice(0, this.buffer.length);
      const payload = this.payloadFor(events);
      if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(`${this.cfg.backendUrl}/analytics/events`, new Blob([payload], { type: 'application/json' }))) return;
      this.buffer.unshift(...events);
    }
    this.flushing = true;
    const events = this.buffer.splice(0, Math.min(this.buffer.length, MAX_BUFFER));
    void this.send(events, 0).finally(() => {
      this.flushing = false;
      if (this.buffer.length > 0 && !this.retryTimer) this.flush();
    });
  }

  private payloadFor(events: AnalyticsEvent[]): string {
    return JSON.stringify({
      siteId: this.cfg.siteId,
      visitorToken: this.visitorToken,
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      returning: this.returning,
      ...this.pageContext(),
      device: this.device,
      browser: this.browser,
      surface: this.surface,
      events,
    });
  }

  private async send(events: AnalyticsEvent[], attempt: number): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.cfg.backendUrl}/analytics/events`, {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: this.payloadFor(events), keepalive: true, signal: controller.signal,
      });
      if (response.ok || !shouldRetryAnalyticsResponse(response.status, attempt)) return;
      throw new Error(`analytics_http_${response.status}`);
    } catch {
      if (attempt >= MAX_RETRIES || this.stopped) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        void this.send(events, attempt + 1).finally(() => {
          if (this.buffer.length > 0 && !this.retryTimer) this.flush();
        });
      }, RETRY_DELAYS_MS[attempt]);
    } finally {
      clearTimeout(timeout);
    }
  }

  private pageContext() {
    return {
      pageUrl: window.location.href,
      pagePath: window.location.pathname || '/',
      pageTitle: document.title || '',
      referrer: document.referrer || undefined,
    };
  }

  private currentPageKey(): string {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }
}

export function shouldRetryAnalyticsResponse(status: number, attempt: number): boolean {
  return status >= 500 && status <= 599 && attempt < MAX_RETRIES;
}

function createEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stripFlush(opts: TrackOptions): Omit<TrackOptions, 'flush'> {
  const { flush: _flush, ...rest } = opts;
  return rest;
}

function detectSurface(): string {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  if (coarse && window.innerWidth < 768) return 'mobile';
  if (coarse) return 'tablet';
  return 'desktop';
}

function detectDevice(): string {
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet/.test(ua)) return 'tablet';
  if (/mobi|android|iphone/.test(ua)) return 'mobile';
  return 'desktop';
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'Other';
}
