/**
 * Popup renderer. Renders ONLY backend-provided content (title/body + CTA). No
 * business copy is hardcoded here; the backend (via the validated popup
 * pipeline) controls whether the popup appears and what it says. Text is set via
 * textContent (never HTML).
 */
import { el } from '../utils/dom.js';
import type { EngageDecision } from '../types.js';

export interface PopupHandle {
  remove: () => void;
}

export interface PopupCallbacks {
  onCta: () => void;
  onDismiss: () => void;
}

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

export function renderPopup(
  layer: HTMLElement,
  decision: EngageDecision,
  cb: PopupCallbacks,
): PopupHandle {
  const card = el('div', 'aire-popup');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Message from assistant');
  if (decision.popupType) card.setAttribute('data-popup-type', decision.popupType);
  if (decision.tone) card.setAttribute('data-tone', decision.tone);

  // Close button.
  const close = el('button', 'aire-popup__close', 'x');
  close.setAttribute('aria-label', 'Dismiss');

  // Neutral chrome (not business copy).
  const brand = el('div', 'aire-popup__brand');
  brand.appendChild(el('span', 'aire-popup__dot'));
  brand.appendChild(el('span', undefined, 'AI Assistant'));

  const titleText = decision.title?.trim();
  const bodyText = decision.body?.trim() || decision.message || '';
  const title = titleText ? el('h3', 'aire-popup__title', titleText) : null;

  // Backend-controlled message.
  const msg = el('p', 'aire-popup__msg', bodyText);

  // Backend-controlled CTA.
  const cta = el('button', 'aire-popup__cta');
  cta.appendChild(el('span', undefined, decision.cta ?? 'Chat'));
  const arrow = el('span');
  arrow.innerHTML = ARROW_SVG; // static, trusted icon markup
  cta.appendChild(arrow);

  card.append(close, brand);
  if (title) card.appendChild(title);
  card.append(msg, cta);
  layer.appendChild(card);

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    card.classList.add('aire-leaving');
    setTimeout(() => card.remove(), 240);
  };

  close.addEventListener('click', () => {
    cb.onDismiss();
    remove();
  });
  cta.addEventListener('click', () => {
    cb.onCta();
    remove();
  });

  return { remove };
}