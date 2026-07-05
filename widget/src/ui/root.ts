/**
 * Shadow DOM host. All widget UI lives inside a closed-off shadow root so the
 * host page's CSS can never collide with ours (and vice versa) — this is what
 * makes the widget framework-independent across React/Vue/Angular/WP/Shopify.
 */
import { STYLES } from './styles.js';

export interface WidgetRoot {
  shadow: ShadowRoot;
  layer: HTMLDivElement;
  destroy: () => void;
}

export function createWidgetRoot(): WidgetRoot {
  const host = document.createElement('div');
  host.id = 'ai-revenue-employee';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483000'; // just below the max so true overlays still win
  host.style.bottom = '0';
  host.style.right = '0';
  host.setAttribute('aria-live', 'polite');

  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STYLES;
  shadow.appendChild(style);

  const layer = document.createElement('div');
  layer.className = 'aire-layer';
  shadow.appendChild(layer);

  document.body.appendChild(host);

  return {
    shadow,
    layer,
    destroy: () => host.remove(),
  };
}
