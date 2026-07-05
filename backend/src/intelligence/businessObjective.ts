/**
 * Business objective mapping (§8) — Sprint 4.1 minimal.
 *
 * Derives the perception-layer BusinessObjective (the Value() input to the
 * policy) from tenant instructions. Full CTA/tone libraries + vertical presets
 * land in Sprint 4.2; here we only need `goalValue` + `isSupport` so the Sales
 * Brain can score in shadow mode.
 */
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessObjective } from './types.js';

/** The default objective when no tenant is resolved (dev-fallback path). */
export const DEFAULT_OBJECTIVE: BusinessObjective = {
  key: 'collect_lead',
  goalValue: 0.7,
  isSupport: false,
};

/**
 * Map tenant instructions → a BusinessObjective. Deliberately conservative:
 * unknown/unset goals get a mid value so we neither over- nor under-interrupt.
 */
export function objectiveFromInstructions(instr: BusinessInstructions | undefined): BusinessObjective {
  if (!instr) return DEFAULT_OBJECTIVE;

  // The resolved instructions currently expose alwaysBookDemo as the strongest
  // goal signal; richer goal config arrives with the Business Goal layer (4.2).
  if (instr.alwaysBookDemo) {
    return { key: 'book_demo', goalValue: 0.9, isSupport: false };
  }
  return { key: 'collect_lead', goalValue: 0.7, isSupport: false };
}
