/**
 * Behaviour buffer — the heart of event buffering.
 *
 * Raw, high-frequency browser events (mousemove, scroll) are folded into cheap
 * AGGREGATES (max scroll depth, last-activity timestamp). Discrete events
 * (clicks, form focus, exit intent) are recorded into a small bounded buffer.
 * The backend never sees raw events — only the summarized snapshot this buffer
 * produces.
 */
import type { VisitorBehaviour } from '../types.js';

const MAX_CLICKS = 20;

export class BehaviourBuffer {
  private pageStart = Date.now();
  private maxScrollDepth = 0;
  private lastActivity = Date.now();
  private clicks: string[] = [];
  private formInteracted = false;
  private exitIntent = false;

  /** Reset all state for a new page (used on SPA navigation). */
  reset(): void {
    this.pageStart = Date.now();
    this.maxScrollDepth = 0;
    this.lastActivity = Date.now();
    this.clicks = [];
    this.formInteracted = false;
    this.exitIntent = false;
  }

  /** Fold a scroll sample into the running maximum. */
  recordScroll(depthPercent: number): void {
    if (depthPercent > this.maxScrollDepth) this.maxScrollDepth = Math.min(100, depthPercent);
    this.markActive();
  }

  /** Note any activity (mouse/keyboard) to reset the inactivity timer. */
  markActive(): void {
    this.lastActivity = Date.now();
  }

  /** Record a discrete click identifier (deduped, bounded). */
  recordClick(id: string): void {
    this.markActive();
    if (!this.clicks.includes(id)) {
      this.clicks.push(id);
      if (this.clicks.length > MAX_CLICKS) this.clicks.shift();
    }
  }

  recordFormInteraction(): void {
    this.formInteracted = true;
    this.markActive();
  }

  recordExitIntent(): void {
    this.exitIntent = true;
  }

  /** Seconds since the last recorded activity. */
  inactiveSeconds(): number {
    return (Date.now() - this.lastActivity) / 1000;
  }

  /** Produce the summarized snapshot sent to the backend. */
  snapshot(): VisitorBehaviour {
    return {
      page: window.location.pathname || '/',
      pageTitle: document.title || '',
      timeOnPage: Math.round((Date.now() - this.pageStart) / 1000),
      scrollDepth: Math.round(this.maxScrollDepth),
      mouseInactive: Math.round(this.inactiveSeconds()),
      clickedElements: [...this.clicks],
      formInteracted: this.formInteracted,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      exitIntent: this.exitIntent,
    };
  }
}
