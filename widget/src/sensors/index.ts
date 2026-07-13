/**
 * Sensor engine - the widget-side entry point for Sprint 4 perception.
 *
 * Picks the device profile, wires the batching emitter to POST /events, and
 * streams a low-rate SEMANTIC feed. This is the ONLY device-aware code in the
 * whole system (�9); everything above the wire is device-blind.
 *
 * Sprint 4 production integration: /events may return a validated popup artifact
 * when the deterministic backend pipeline decides to speak. The sensor engine
 * only transports that artifact to the orchestrator; it never decides whether
 * to interrupt on its own.
 */
import type { EventsClientState, EventsResponse, PopupArtifact } from '../types.js';
import type { SemanticEvent, SensorAdapter, Surface } from './types.js';
import { DesktopSensors } from './desktop.js';
import { MobileSensors } from './mobile.js';
import { EventEmitter } from './emitter.js';
import { getSessionId, getVisitorId, resolveReturning } from './session.js';

export interface SensorEngineOptions {
  siteId: string;
  backendUrl: string;
  debug: boolean;
  getClientState: () => EventsClientState;
  onPopup: (popup: PopupArtifact) => void;
}

/** Coarse surface detection - pointer + viewport. Only affects which sensors run. */
function detectSurface(): Surface {
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.innerWidth < 768;
  if (coarse && narrow) return 'mobile';
  if (coarse && !narrow) return 'tablet';
  return 'desktop';
}

export class SensorEngine {
  private adapter: SensorAdapter | null = null;
  private emitter: EventEmitter | null = null;
  private readonly sessionId = getSessionId();
  private readonly visitorId = getVisitorId();
  private readonly returning = resolveReturning();
  private readonly surface = detectSurface();

  constructor(private readonly opts: SensorEngineOptions) {}

  start(): void {
    if (this.adapter) return;

    this.emitter = new EventEmitter({
      surface: this.surface,
      send: (events) => this.send(events),
      log: this.opts.debug ? (...a) => console.log(...a) : undefined,
    });

    // Tablet uses the desktop profile (it has a pointer); only the threshold
    // constant differs on the backend.
    this.adapter = this.surface === 'mobile' ? new MobileSensors(this.emitter.emit) : new DesktopSensors(this.emitter.emit);

    this.emitter.begin();
    this.adapter.start();
    if (this.opts.debug) console.log('[AIRE popup-trace] stage=1_widget_event_collection sensors_started', { surface: this.surface, returning: this.returning, sessionId: this.sessionId.slice(0, 8) });
  }

  stop(): void {
    this.adapter?.stop();
    this.adapter = null;
    this.emitter?.stop();
    this.emitter = null;
  }

  /** Send a semantic batch and consume the optional validated popup artifact. */
  private send(events: SemanticEvent[]): void {
    if (this.opts.debug) {
      console.log('[AIRE popup-trace] stage=1_widget_event_collection sending_batch', {
        passed: events.length > 0,
        eventCount: events.length,
        events: events.map((e) => ({ type: e.type, zone: e.zone, intensity: e.intensity, ts: e.ts })),
        clientState: this.opts.getClientState(),
      });
    }

    const body = JSON.stringify({
      siteId: this.opts.siteId,
      sessionId: this.sessionId,
      visitorId: this.visitorId,
      returning: this.returning,
      surface: this.surface,
      pageUrl: window.location.href,
      pagePath: window.location.pathname || '/',
      pageTitle: document.title || '',
      referrer: document.referrer || undefined,
      device: detectDevice(),
      browser: detectBrowser(),
      clientState: this.opts.getClientState(),
      events,
      botSignal: { webdriver: navigatorWebdriver() },
    });

    void fetch(`${this.opts.backendUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
      .then(async (res) => {
        if (!res.ok) return;
        const payload = (await res.json().catch(() => null)) as EventsResponse | null;
        const popup = payload?.popup;
        if (isPopupArtifact(popup)) this.opts.onPopup(popup);
      })
      .catch(() => {
        /* transport failures are silent */
      });
  }
}

function isPopupArtifact(value: unknown): value is PopupArtifact {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PopupArtifact>;
  return typeof v.title === 'string'
    && typeof v.body === 'string'
    && typeof v.popupType === 'string'
    && typeof v.tone === 'string'
    && (v.cta === undefined || typeof v.cta === 'string')
    && (v.primaryAction === undefined || typeof v.primaryAction === 'string')
    && (v.secondaryAction === undefined || typeof v.secondaryAction === 'string')
    && (v.action === undefined || isBusinessAction(v.action))
    && (v.secondaryActionConfig === undefined || isBusinessAction(v.secondaryActionConfig));
}

function isBusinessAction(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.actionId === 'string'
    && typeof v.label === 'string'
    && typeof v.destinationType === 'string'
    && typeof v.destination === 'string'
    && typeof v.enabled === 'boolean';
}

function navigatorWebdriver(): boolean {
  return (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
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