/**
 * Widget-side mirror of the backend semantic-event contract (§3.1).
 *
 * Kept independent of the backend package (the widget bundle has no shared
 * deps), but the shapes must stay in lockstep with
 * backend/src/intelligence/types.ts.
 *
 * The widget emits ONLY these semantic events — never raw coordinates, never
 * keystrokes (§3.4). Mechanical events are reduced to semantics at this edge.
 */

export type Zone = 'pricing' | 'faq' | 'cta' | 'trust' | 'product' | 'contact' | 'other';

export type SemanticType =
  | 'content_dwell'
  | 'zone_revisit'
  | 'pricing_focus'
  | 'cta_proximity'
  | 'cta_engage'
  | 'form_start'
  | 'form_stall'
  | 'exit_signal'
  | 'idle'
  | 'resume';

export type Surface = 'desktop' | 'mobile' | 'tablet';

export interface SemanticEvent {
  type: SemanticType;
  zone: Zone;
  /** Normalized magnitude 0..1. */
  intensity: number;
  /** Monotonic ms since session start (NOT epoch). */
  ts: number;
  surface: Surface;
}

/** Callback the sensor adapters use to emit a reduced semantic event. */
export type EmitFn = (type: SemanticType, zone: Zone, intensity?: number) => void;

/**
 * A device sensor profile. The ONLY device-aware code in the system (§9): both
 * implementations emit the identical SemanticEvent stream from different raw
 * material.
 */
export interface SensorAdapter {
  readonly surface: Surface;
  /** Begin observing; events flow through the emit fn passed at construction. */
  start(): void;
  /** Detach all listeners/observers. */
  stop(): void;
}
