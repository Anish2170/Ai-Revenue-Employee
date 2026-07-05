/**
 * Tracker — maintains the continuous visitor state and emits engagement
 * milestones to the orchestrator.
 *
 * Wraps the {@link BehaviourBuffer} (event buffering) and the DOM listeners,
 * plus a periodic tick that fires a time/scroll milestone as dwell accumulates.
 * Also detects SPA navigations and resets per-page state.
 */
import { BehaviourBuffer } from './buffer.js';
import { attachBehaviourListeners, type MilestoneReason } from './events.js';
import type { VisitorBehaviour } from '../types.js';

export type { MilestoneReason };

/** Reasons that can trigger an engagement evaluation. */
export type MilestoneEvent = MilestoneReason | 'dwell' | 'navigation';

const DWELL_MILESTONE_SECONDS = 25;
const TICK_MS = 5000;

export class Tracker {
  private buffer = new BehaviourBuffer();
  private detach: (() => void) | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private dwellFired = false;
  private lastPath = window.location.pathname;

  constructor(private readonly onMilestone: (reason: MilestoneEvent) => void) {}

  start(): void {
    this.detach = attachBehaviourListeners(this.buffer, (reason) => this.onMilestone(reason));

    this.tick = setInterval(() => {
      this.detectNavigation();
      const snap = this.buffer.snapshot();
      if (!this.dwellFired && snap.timeOnPage >= DWELL_MILESTONE_SECONDS) {
        this.dwellFired = true;
        this.onMilestone('dwell');
      }
    }, TICK_MS);

    // Catch SPA route changes via history API.
    window.addEventListener('popstate', this.onNavigate);
    this.patchHistory();
  }

  stop(): void {
    this.detach?.();
    this.detach = null;
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    window.removeEventListener('popstate', this.onNavigate);
  }

  /** The current summarized snapshot to send to the backend. */
  snapshot(): VisitorBehaviour {
    return this.buffer.snapshot();
  }

  private detectNavigation(): void {
    if (window.location.pathname !== this.lastPath) {
      this.lastPath = window.location.pathname;
      this.buffer.reset();
      this.dwellFired = false;
      this.onMilestone('navigation');
    }
  }

  private onNavigate = () => {
    // Defer until after the SPA updates location/title.
    setTimeout(() => this.detectNavigation(), 0);
  };

  /** Wrap pushState/replaceState so SPA navigations emit popstate-like events. */
  private patchHistory(): void {
    const fire = () => window.dispatchEvent(new Event('popstate'));
    const { pushState, replaceState } = history;
    history.pushState = function (...args) {
      const r = pushState.apply(this, args as Parameters<typeof pushState>);
      fire();
      return r;
    };
    history.replaceState = function (...args) {
      const r = replaceState.apply(this, args as Parameters<typeof replaceState>);
      fire();
      return r;
    };
  }
}
