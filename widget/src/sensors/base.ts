/**
 * Shared sensor plumbing common to both surfaces.
 *
 * Device-INDEPENDENT concerns live here so desktop/mobile only implement what
 * genuinely differs (§9): form lifecycle, idle/resume, and turning "attention on
 * a zone" into the right semantic events (content_dwell, pricing_focus, and
 * zone_revisit on a second visit).
 *
 * Subclasses attach their surface-specific listeners in onStart()/onStop() and
 * call `noteAttention(zone, intensity)` when they detect focused attention.
 */
import type { EmitFn, SensorAdapter, Surface, Zone } from './types.js';
import { resolveZone } from './zones.js';

/** Idle threshold — no activity beyond this ⇒ emit `idle` (§3.2). */
const IDLE_MS = 12_000;
/** Form stall threshold — focused but no input beyond this ⇒ `form_stall`. */
const FORM_STALL_MS = 8_000;

export abstract class BaseSensors implements SensorAdapter {
  abstract readonly surface: Surface;

  private zonesSeen = new Set<Zone>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private isIdle = false;

  private formActive = false;
  private formZone: Zone = 'other';
  private formStallTimer: ReturnType<typeof setTimeout> | null = null;
  private formStalled = false;

  constructor(protected readonly emit: EmitFn) {}

  start(): void {
    // Shared listeners: form lifecycle + activity for idle/resume.
    document.addEventListener('focusin', this.onFocusIn, true);
    document.addEventListener('input', this.onInput, true);
    document.addEventListener('focusout', this.onFocusOut, true);
    this.armIdle();
    this.onStart();
  }

  stop(): void {
    document.removeEventListener('focusin', this.onFocusIn, true);
    document.removeEventListener('input', this.onInput, true);
    document.removeEventListener('focusout', this.onFocusOut, true);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.formStallTimer) clearTimeout(this.formStallTimer);
    this.onStop();
  }

  /** Surface-specific setup/teardown. */
  protected abstract onStart(): void;
  protected abstract onStop(): void;

  /**
   * Record focused attention on a zone. Emits content_dwell (+ pricing_focus on
   * pricing), and zone_revisit if this zone was attended before. Subclasses call
   * this once a *settled* attention is detected (hover-dwell / scroll-stop).
   */
  protected noteAttention(zone: Zone, intensity = 0.6): void {
    this.markActive();
    if (this.zonesSeen.has(zone)) {
      this.emit('zone_revisit', zone, Math.min(1, intensity + 0.1));
    } else {
      this.zonesSeen.add(zone);
    }
    this.emit('content_dwell', zone, intensity);
    if (zone === 'pricing') this.emit('pricing_focus', zone, Math.min(1, intensity + 0.1));
  }

  /** Subclasses call this on any user activity to drive idle/resume. */
  protected markActive(): void {
    if (this.isIdle) {
      this.isIdle = false;
      this.emit('resume', 'other', 0.5);
    }
    this.armIdle();
  }

  private armIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.isIdle = true;
      this.emit('idle', 'other', 1);
    }, IDLE_MS);
  }

  // --- Form lifecycle (shared) ---

  private onFocusIn = (e: Event): void => {
    const t = e.target as Element | null;
    if (!isFormField(t)) return;
    this.markActive();
    if (!this.formActive) {
      this.formActive = true;
      this.formStalled = false;
      this.formZone = resolveZone(t);
      this.emit('form_start', this.formZone, 0.8);
    }
    this.armFormStall();
  };

  private onInput = (e: Event): void => {
    if (!isFormField(e.target as Element | null)) return;
    this.markActive();
    // Typing means not stalled — re-arm the stall timer (never read content).
    this.armFormStall();
  };

  private onFocusOut = (e: Event): void => {
    if (!isFormField(e.target as Element | null)) return;
    if (this.formStallTimer) clearTimeout(this.formStallTimer);
  };

  private armFormStall(): void {
    if (this.formStallTimer) clearTimeout(this.formStallTimer);
    this.formStalled = false;
    this.formStallTimer = setTimeout(() => {
      if (this.formActive && !this.formStalled) {
        this.formStalled = true;
        this.emit('form_stall', this.formZone, 0.8);
      }
    }, FORM_STALL_MS);
  }
}

function isFormField(el: Element | null): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}
