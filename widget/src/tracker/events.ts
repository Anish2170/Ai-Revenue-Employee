/**
 * DOM event wiring. Attaches throttled listeners that feed the
 * {@link BehaviourBuffer} and emit coarse "milestone" reasons upward. Returns a
 * teardown function. No business logic lives here.
 */
import type { BehaviourBuffer } from './buffer.js';
import { describeElement } from '../utils/dom.js';
import { throttle } from '../utils/debounce.js';

export type MilestoneReason = 'scroll' | 'click' | 'form' | 'exit_intent';

function scrollDepthPercent(): number {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  if (scrollable <= 0) return 100; // short pages count as fully seen
  return Math.min(100, ((window.scrollY || doc.scrollTop) / scrollable) * 100);
}

export function attachBehaviourListeners(
  buffer: BehaviourBuffer,
  emit: (reason: MilestoneReason) => void,
): () => void {
  const onScroll = throttle(() => {
    const depth = scrollDepthPercent();
    buffer.recordScroll(depth);
    if (depth >= 60) emit('scroll');
  }, 400);

  const onMouseMove = throttle(() => buffer.markActive(), 1000);

  const onClick = (e: MouseEvent) => {
    const id = describeElement(e.target);
    if (id) {
      buffer.recordClick(id);
      emit('click');
    }
  };

  const onFormInteract = (e: Event) => {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
      buffer.recordFormInteraction();
      emit('form');
    }
  };

  const onMouseOut = (e: MouseEvent) => {
    // Cursor leaving toward the top of the viewport ⇒ likely exit intent.
    if (!e.relatedTarget && e.clientY <= 0) {
      buffer.recordExitIntent();
      emit('exit_intent');
    }
  };

  const onKey = () => buffer.markActive();

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('focusin', onFormInteract, true);
  document.addEventListener('input', onFormInteract, true);
  document.addEventListener('keydown', onKey, { passive: true });
  document.addEventListener('mouseout', onMouseOut);

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('focusin', onFormInteract, true);
    document.removeEventListener('input', onFormInteract, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mouseout', onMouseOut);
  };
}
