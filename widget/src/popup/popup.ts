/**
 * Popup renderer. Renders ONLY backend-provided content (title/body + optional
 * resolved business actions). Text is set via textContent (never HTML).
 */
import { el } from '../utils/dom.js';
import type { BusinessActionConfig, EngageDecision } from '../types.js';

export interface PopupHandle {
  remove: () => void;
}

export interface PopupCallbacks {
  onCta: (action?: BusinessActionConfig) => void;
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

  const close = el('button', 'aire-popup__close', 'x');
  close.setAttribute('aria-label', 'Dismiss');

  const brand = el('div', 'aire-popup__brand');
  brand.appendChild(el('span', 'aire-popup__dot'));
  brand.appendChild(el('span', undefined, 'AI Assistant'));

  const titleText = decision.title?.trim();
  const bodyText = decision.body?.trim() || decision.message || '';
  const title = titleText ? el('h3', 'aire-popup__title', titleText) : null;
  const msg = el('p', 'aire-popup__msg', bodyText);

  const primaryCta = decision.action ? popupButton(decision.action.label, 'primary') : decision.cta ? popupButton(decision.cta, 'legacy') : null;
  const secondaryCta = decision.secondaryActionConfig ? popupButton(decision.secondaryActionConfig.label, 'secondary') : null;

  card.append(close, brand);
  if (title) card.appendChild(title);
  card.appendChild(msg);
  if (primaryCta || secondaryCta) {
    const actions = el('div', 'aire-popup__actions');
    if (primaryCta) actions.appendChild(primaryCta);
    if (secondaryCta) actions.appendChild(secondaryCta);
    card.appendChild(actions);
  }
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
  primaryCta?.addEventListener('click', () => {
    cb.onCta(decision.action);
    remove();
  });
  secondaryCta?.addEventListener('click', () => {
    cb.onCta(decision.secondaryActionConfig);
    remove();
  });

  return { remove };
}

function popupButton(label: string, kind: 'primary' | 'secondary' | 'legacy'): HTMLButtonElement {
  const button = el('button', kind === 'secondary' ? 'aire-popup__cta aire-popup__cta--secondary' : 'aire-popup__cta') as HTMLButtonElement;
  button.appendChild(el('span', undefined, label));
  const arrow = el('span');
  arrow.innerHTML = ARROW_SVG; // static, trusted icon markup
  button.appendChild(arrow);
  return button;
}
