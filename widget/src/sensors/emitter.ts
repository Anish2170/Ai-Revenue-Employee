/**
 * Semantic-event emitter — the edge-side batching + transport (§1.6, §3.5).
 *
 * Sensors call `emit(type, zone, intensity)`; this buffers the reduced events
 * and flushes them to POST /events on a low cadence (and on pagehide). Batching
 * protects battery (mobile), privacy, and backend cost — the widget streams a
 * low-rate SEMANTIC feed, never raw events.
 *
 * Fully fire-and-forget: transport failures never surface to the page.
 */
import type { EmitFn, SemanticEvent, SemanticType, Surface, Zone } from './types.js';

export interface EmitterOptions {
  surface: Surface;
  /** Shared visit origin: reloads must not restart the backend's cooldown clock. */
  sessionStartedAt?: number;
  /** Flush interval in ms. */
  flushMs?: number;
  /** Max buffered events before an early flush. */
  maxBuffer?: number;
  /** Sends a batch of events; must not throw. */
  send: (events: SemanticEvent[]) => void;
  /** Optional debug logger. */
  log?: (...args: unknown[]) => void;
}

const DEFAULT_FLUSH_MS = 4000;
const DEFAULT_MAX_BUFFER = 25;
/** Drop sub-threshold intensity noise at the edge (§3.4). */
const MIN_INTENSITY = 0.05;

export class EventEmitter {
  private buffer: SemanticEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly start: number;
  private readonly flushMs: number;
  private readonly maxBuffer: number;
  private stopped = false;
  private lastTs = 0;

  constructor(private readonly opts: EmitterOptions) {
    this.start = opts.sessionStartedAt ?? Date.now();
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
    this.maxBuffer = opts.maxBuffer ?? DEFAULT_MAX_BUFFER;
  }

  /** Bind-friendly emit function handed to the sensor adapters. */
  readonly emit: EmitFn = (type: SemanticType, zone: Zone, intensity = 0.6) => {
    if (this.stopped) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    if (clamped < MIN_INTENSITY) return;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    this.buffer.push({ id, type, zone, intensity: clamped, ts: this.now(), surface: this.opts.surface });
    this.opts.log?.('[AIRE] emit', type, zone, clamped.toFixed(2));
    if (this.buffer.length >= this.maxBuffer) this.flush();
  };

  begin(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.flushMs);
    // Flush whatever is pending when the page is being hidden/closed.
    window.addEventListener('pagehide', this.flushNow, { capture: true });
    document.addEventListener('visibilitychange', this.onVisibility, { capture: true });
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('pagehide', this.flushNow, { capture: true } as EventListenerOptions);
    document.removeEventListener('visibilitychange', this.onVisibility, { capture: true } as EventListenerOptions);
    this.flush();
  }

  /** Nondecreasing ms since the visit origin, shared across page loads. */
  private now(): number {
    this.lastTs = Math.max(this.lastTs, Date.now() - this.start, 0);
    return this.lastTs;
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      this.opts.send(batch);
    } catch {
      /* transport owns its own safety; never throw to the page */
    }
  }

  private flushNow = (): void => this.flush();
  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.flush();
  };
}
