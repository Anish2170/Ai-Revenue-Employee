import { failureCategory } from '../llm/provider/errors.js';
import { failPopup, type PopupCandidate } from './popupLifecycle.js';
import type { VisitorSession } from './session/visitorSession.js';

export function failPopupGeneration(session: VisitorSession, candidate: PopupCandidate, error: unknown): 'popup_cancelled' | 'popup_timeout' | 'popup_generation_failed' {
  // Cleanup aborts the controller itself. Preserve the original failure first.
  const reason = candidate.controller.signal.aborted
    ? 'popup_cancelled'
    : failureCategory(error) === 'timeout' ? 'popup_timeout' : 'popup_generation_failed';
  failPopup(session, candidate);
  return reason;
}
