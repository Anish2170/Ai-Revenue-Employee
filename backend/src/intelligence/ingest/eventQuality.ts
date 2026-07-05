/**
 * Event-quality validation (§10.4).
 *
 * Cheap, deterministic checks run at ingest BEFORE the perception stack sees a
 * batch. Rejects malformed events, clamps ranges, drops impossible sequences.
 * Never throws — returns cleaned events + a list of drop reasons for the trace.
 */
import { SEMANTIC_TYPES, ZONES, SURFACES, type SemanticEvent } from '../types.js';

export interface QualityResult {
  /** The accepted, cleaned events (sorted by ts asc). */
  clean: SemanticEvent[];
  /** Human-readable reasons for anything dropped (for debugging/metrics). */
  dropped: string[];
}

const TYPES = new Set<string>(SEMANTIC_TYPES);
const ZONE_SET = new Set<string>(ZONES);
const SURFACE_SET = new Set<string>(SURFACES);

/** Max plausible session length (ms) — events beyond this are clock errors. */
const MAX_TS = 6 * 60 * 60 * 1000; // 6h

/**
 * Validate and clean a raw event batch.
 *
 * @param raw       Untrusted events from the widget.
 * @param priorSeen Event kinds already accepted this session (for sequence
 *                  checks that span batches — e.g. form_stall needs a prior
 *                  form_start). Pass an empty set for a fresh session.
 */
export function validateEvents(raw: unknown[], priorSeen: Set<string> = new Set()): QualityResult {
  const clean: SemanticEvent[] = [];
  const dropped: string[] = [];
  const seen = new Set(priorSeen);

  // First pass: shape + range validation.
  const candidates: SemanticEvent[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      dropped.push('not_an_object');
      continue;
    }
    const e = item as Record<string, unknown>;
    if (typeof e.type !== 'string' || !TYPES.has(e.type)) {
      dropped.push(`unknown_type:${String(e.type)}`);
      continue;
    }
    if (typeof e.zone !== 'string' || !ZONE_SET.has(e.zone)) {
      dropped.push(`unknown_zone:${String(e.zone)}`);
      continue;
    }
    const surface = typeof e.surface === 'string' && SURFACE_SET.has(e.surface) ? e.surface : 'desktop';
    const ts = typeof e.ts === 'number' && Number.isFinite(e.ts) ? e.ts : NaN;
    if (Number.isNaN(ts) || ts < 0 || ts > MAX_TS) {
      dropped.push('bad_ts');
      continue;
    }
    const intensityRaw = typeof e.intensity === 'number' && Number.isFinite(e.intensity) ? e.intensity : 0.5;
    const intensity = Math.max(0, Math.min(1, intensityRaw)); // clamp

    candidates.push({
      type: e.type as SemanticEvent['type'],
      zone: e.zone as SemanticEvent['zone'],
      intensity,
      ts,
      surface: surface as SemanticEvent['surface'],
    });
  }

  // Sort by ts so monotonic-order and sequence checks are meaningful.
  candidates.sort((a, b) => a.ts - b.ts);

  // Second pass: sequence sanity (impossible orderings, §10.4).
  for (const e of candidates) {
    if (e.type === 'form_stall' && !seen.has('form_start')) {
      dropped.push('form_stall_without_start');
      continue;
    }
    if (e.type === 'resume' && !seen.has('idle')) {
      dropped.push('resume_without_idle');
      continue;
    }
    seen.add(e.type);
    clean.push(e);
  }

  return { clean, dropped };
}
