/**
 * Sensor engine — the widget-side entry point for Sprint 4 perception.
 *
 * Picks the device profile, wires the batching emitter to POST /events, and
 * streams a low-rate SEMANTIC feed. This is the ONLY device-aware code in the
 * whole system (§9); everything above the wire is device-blind.
 *
 * Sprint 4.1 is SHADOW MODE: the engine only observes and streams. It never
 * shows anything and never changes the existing popup/chat behaviour.
 */
import type { SemanticEvent, SensorAdapter, Surface } from './types.js';
import { DesktopSensors } from './desktop.js';
import { MobileSensors } from './mobile.js';
import { EventEmitter } from './emitter.js';
import { getSessionId, resolveReturning } from './session.js';

export interface SensorEngineOptions {
  siteId: string;
  backendUrl: string;
  debug: boolean;
}

/** Coarse surface detection — pointer + viewport. Only affects which sensors run. */
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

  /** Fire-and-forget batch send. Uses sendBeacon on unload paths when possible. */
  private send(events: SemanticEvent[]): void {
    const body = JSON.stringify({
      siteId: this.opts.siteId,
      sessionId: this.sessionId,
      returning: this.returning,
      surface: this.surface,
      events,
      botSignal: { webdriver: navigatorWebdriver() },
    });

    const url = `${this.opts.backendUrl}/events`;
    // Prefer sendBeacon (survives page unload); fall back to fetch keepalive.
    const beacon = (navigator as Navigator & { sendBeacon?: (u: string, d: BodyInit) => boolean }).sendBeacon;
    if (beacon) {
      try {
        if (beacon.call(navigator, url, new Blob([body], { type: 'application/json' }))) return;
      } catch {
        /* fall through to fetch */
      }
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      /* shadow mode: transport failures are silent */
    });
  }
}

function navigatorWebdriver(): boolean {
  return (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
}
