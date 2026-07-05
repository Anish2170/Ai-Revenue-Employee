/**
 * Mobile sensor profile (§3.4, §9).
 *
 * No hover, small viewport, touch + motion. We reconstruct the SAME semantic
 * events from different raw material:
 *   - scroll-stop with a zone sustained in view → content_dwell / pricing_focus
 *   - a zone re-entering view after leaving      → zone_revisit (via base)
 *   - tap on a CTA / tel: / whatsapp             → cta_engage (a mobile conversion)
 *   - back-button, scroll-to-top burst, hide     → exit_signal
 *
 * Attention is inferred from IntersectionObserver + a scroll-stop debounce,
 * never a pointer.
 */
import { BaseSensors } from './base.js';
import { resolveZone, isCtaElement, isContactLink } from './zones.js';
import type { Surface } from './types.js';
import { throttle, debounce } from '../utils/debounce.js';

/** A zone element must be at least this visible to count toward attention. */
const VISIBLE_RATIO = 0.5;
/** Scroll considered "stopped" this long after the last scroll event. */
const SCROLL_STOP_MS = 550;
/** Max elements to observe (perf guard on large pages). */
const MAX_OBSERVED = 150;
/** A jump up to near the top this fast reads as an exit-ish burst. */
const SCROLL_TOP_BURST_PX = 400;

export class MobileSensors extends BaseSensors {
  readonly surface: Surface = 'mobile';

  private io: IntersectionObserver | null = null;
  private visible = new Map<Element, number>(); // element → ratio
  private lastScrollY = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  protected onStart(): void {
    this.lastScrollY = window.scrollY;
    this.io = new IntersectionObserver((entries) => this.onIntersect(entries), {
      threshold: [0, VISIBLE_RATIO, 1],
    });
    this.observeZones();
    // SPA pages mutate — periodically pick up newly-added sections (cheap).
    this.refreshTimer = setInterval(() => this.observeZones(), 5000);

    window.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('touchstart', this.onTouch, { passive: true });
    window.addEventListener('popstate', this.onBack);
    document.addEventListener('click', this.onTap, true);
    document.addEventListener('visibilitychange', this.onHide, true);
  }

  protected onStop(): void {
    this.io?.disconnect();
    this.io = null;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    window.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('touchstart', this.onTouch);
    window.removeEventListener('popstate', this.onBack);
    document.removeEventListener('click', this.onTap, true);
    document.removeEventListener('visibilitychange', this.onHide, true);
  }

  /** Observe a bounded set of structural / CTA elements for visibility. */
  private observeZones(): void {
    if (!this.io) return;
    const nodes = document.querySelectorAll<HTMLElement>(
      'section, header, footer, main, article, [data-section], [id], a, button',
    );
    let count = 0;
    for (const el of nodes) {
      if (count >= MAX_OBSERVED) break;
      if (this.visible.has(el)) {
        count++;
        continue;
      }
      // Only bother observing elements that resolve to a real zone or are CTAs.
      const zone = resolveZone(el);
      if (zone === 'other' && !isCtaElement(el)) continue;
      this.io.observe(el);
      this.visible.set(el, 0);
      count++;
    }
  }

  private onIntersect(entries: IntersectionObserverEntry[]): void {
    for (const e of entries) {
      this.visible.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
    }
  }

  private onScroll = throttle(() => {
    this.markActive();
    const y = window.scrollY;
    // Fast jump toward the very top ⇒ exit-ish burst.
    if (this.lastScrollY - y >= SCROLL_TOP_BURST_PX && y < 200) {
      this.emit('exit_signal', 'other', 0.6);
    }
    this.lastScrollY = y;
    this.settleScroll();
  }, 120) as () => void;

  /** On scroll-stop, credit the most-visible zone as attention. */
  private settleScroll = debounce(() => {
    let bestEl: Element | null = null;
    let bestRatio = VISIBLE_RATIO;
    for (const [el, ratio] of this.visible) {
      if (ratio >= bestRatio) {
        bestRatio = ratio;
        bestEl = el;
      }
    }
    if (!bestEl) return;
    const zone = resolveZone(bestEl);
    if (zone === 'other') return;
    this.noteAttention(zone, dwellFromRatio(bestRatio));
  }, SCROLL_STOP_MS);

  private onTouch = (): void => this.markActive();

  private onTap = (e: MouseEvent): void => {
    this.markActive();
    const el = e.target as Element | null;
    const cta = el?.closest('a,button,[role="button"]') ?? null;
    if (cta && (isCtaElement(cta) || isContactLink(cta))) {
      // Tap-to-call / WhatsApp / checkout are the conversion on mobile.
      this.emit('cta_engage', 'cta', isContactLink(cta) ? 1 : 0.9);
    } else {
      this.noteAttention(resolveZone(el), 0.6);
    }
  };

  private onBack = (): void => {
    this.emit('exit_signal', 'other', 0.7);
  };

  private onHide = (): void => {
    if (document.visibilityState === 'hidden') this.emit('exit_signal', 'other', 0.6);
  };
}

function dwellFromRatio(ratio: number): number {
  return Math.min(1, 0.4 + ratio * 0.6);
}
