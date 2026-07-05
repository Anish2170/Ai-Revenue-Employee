/**
 * Sensor engine - the widget-side entry point for Sprint 4 perception.
 *
 * Picks the device profile, wires the batching emitter to POST /events, and
 * streams a low-rate SEMANTIC feed. This is the ONLY device-aware code in the
 * whole system (§9); everything above the wire is device-blind.
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
import { getSessionId, resolveReturning } from './session.js';

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
    if (this.opts.debug) console.log('[AIRE] sensors started', { surface: this.surface, returning: this.returning });
  }

  stop(): void {
    this.adapter?.stop();
    this.adapter = null;
    this.emitter?.stop();
    this.emitter = null;
  }

  /** Send a semantic batch and consume the optional validated popup artifact. */
  private send(events: SemanticEvent[]): void {
    const body = JSON.stringify({
      siteId: this.opts.siteId,
      sessionId: this.sessionId,
      returning: this.returning,
      surface: this.surface,
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
    && typeof v.cta === 'string'
    && typeof v.popupType === 'string'
    && typeof v.tone === 'string';
}

function navigatorWebdriver(): boolean {
  return (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
}