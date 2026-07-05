/**
 * Desktop sensor profile (§3.4, §9).
 *
 * A pointer + large viewport give rich micro-behaviour. We derive the shared
 * semantic events from:
 *   - hover-dwell settling on a zone      → content_dwell / pricing_focus / revisit
 *   - cursor near a CTA without clicking  → cta_proximity
 *   - click on a CTA                      → cta_engage
 *   - cursor leaving toward the tab bar   → exit_signal
 *
 * All raw pointer data is consumed HERE and discarded — only semantics leave.
 */
import { BaseSensors } from './base.js';
import { resolveZone, isCtaElement } from './zones.js';
import type { Surface } from './types.js';
import { throttle } from '../utils/debounce.js';

/** Hover must settle on a zone this long before it counts as attention. */
const DWELL_MS = 900;
/** Cursor within this many px of a CTA (without click) ⇒ proximity. */
const CTA_PROXIMITY_PX = 60;
/** Re-emit proximity for the same CTA at most this often. */
const PROXIMITY_COOLDOWN_MS = 4000;

export class DesktopSensors extends BaseSensors {
  readonly surface: Surface = 'desktop';

  private hoverZone: string | null = null;
  private hoverSince = 0;
  private lastProximityAt = 0;

  protected onStart(): void {
    window.addEventListener('mousemove', this.onMouseMove, { passive: true });
    document.addEventListener('mouseout', this.onMouseOut);
    document.addEventListener('click', this.onClick, true);
  }

  protected onStop(): void {
    window.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseout', this.onMouseOut);
    document.removeEventListener('click', this.onClick, true);
  }

  private onMouseMove = throttle((e: MouseEvent) => {
    this.markActive();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const zone = resolveZone(el);

    // Hover-dwell: settle on a zone, then count it as attention once.
    if (zone !== this.hoverZone) {
      this.settleHover();
      this.hoverZone = zone;
      this.hoverSince = Date.now();
    } else if (this.hoverSince && Date.now() - this.hoverSince >= DWELL_MS) {
      this.noteAttention(zone, dwellIntensity(Date.now() - this.hoverSince));
      // Reset so we don't spam; a fresh dwell requires re-settling.
      this.hoverSince = 0;
    }

    // CTA proximity: near a CTA the cursor hasn't clicked.
    this.checkProximity(e);
  }, 150) as (e: MouseEvent) => void;

  private checkProximity(e: MouseEvent): void {
    if (Date.now() - this.lastProximityAt < PROXIMITY_COOLDOWN_MS) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cta = el?.closest('a,button,[role="button"]') ?? null;
    if (!cta || !isCtaElement(cta)) return;
    const rect = cta.getBoundingClientRect();
    const dx = Math.max(rect.left - e.clientX, 0, e.clientX - rect.right);
    const dy = Math.max(rect.top - e.clientY, 0, e.clientY - rect.bottom);
    const dist = Math.hypot(dx, dy);
    if (dist <= CTA_PROXIMITY_PX) {
      this.lastProximityAt = Date.now();
      this.emit('cta_proximity', 'cta', 0.7);
    }
  }

  private onMouseOut = (e: MouseEvent): void => {
    // Cursor leaving toward the top of the viewport ⇒ reaching for the tab bar.
    if (!e.relatedTarget && e.clientY <= 0) {
      this.emit('exit_signal', 'other', 0.8);
    }
  };

  private onClick = (e: MouseEvent): void => {
    this.markActive();
    const el = e.target as Element | null;
    const cta = el?.closest('a,button,[role="button"]') ?? null;
    if (cta && isCtaElement(cta)) {
      this.emit('cta_engage', 'cta', 0.9);
    } else {
      // A non-CTA click still signals attention on its zone.
      this.noteAttention(resolveZone(el), 0.6);
    }
  };

  /** If the current hover already exceeded DWELL_MS when zone changes, credit it. */
  private settleHover(): void {
    if (this.hoverZone && this.hoverSince && Date.now() - this.hoverSince >= DWELL_MS) {
      this.noteAttention(this.hoverZone as ReturnType<typeof resolveZone>, dwellIntensity(Date.now() - this.hoverSince));
    }
  }
}

/** Longer dwell ⇒ higher intensity, saturating around ~6s. */
function dwellIntensity(ms: number): number {
  return Math.min(1, 0.4 + ms / 10_000);
}
