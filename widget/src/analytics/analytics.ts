import type { WidgetConfig } from '../types.js';
import { getSessionId, getVisitorId, resolveReturning } from '../sensors/session.js';

type AnalyticsCategory = 'VISITOR' | 'PAGE' | 'POPUP' | 'CHAT' | 'KNOWLEDGE' | 'WIDGET';

interface AnalyticsEvent {
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
}

export interface TrackOptions extends Partial<Omit<AnalyticsEvent, 'category' | 'eventName' | 'occurredAt'>> {
  flush?: boolean;
}

const FLUSH_MS = 5000;
const MAX_BUFFER = 20;

export class AnalyticsTracker {
  private readonly visitorId = getVisitorId();
  private readonly sessionId = getSessionId();
  private readonly returning = resolveReturning();
  private readonly device = detectDevice();
  private readonly browser = detectBrowser();
  private readonly surface = detectSurface();
  private readonly sessionStartedAt = Date.now();
  private pageStartedAt = Date.now();
  private pageKey = this.currentPageKey();
  private buffer: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private sessionEnded = false;

  constructor(private readonly cfg: WidgetConfig) {}

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
    if (this.buffer.length === 0) return;
    const events = this.buffer;
    this.buffer = [];

    const payload = JSON.stringify({
      siteId: this.cfg.siteId,
      visitorId: this.visitorId,
      sessionId: this.sessionId,
      returning: this.returning,
      ...this.pageContext(),
      device: this.device,
      browser: this.browser,
      surface: this.surface,
      events,
    });

    if (useBeacon && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(`${this.cfg.backendUrl}/analytics/events`, new Blob([payload], { type: 'application/json' }));
      if (ok) return;
    }

    void fetch(`${this.cfg.backendUrl}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      /* analytics transport is intentionally silent */
    });
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