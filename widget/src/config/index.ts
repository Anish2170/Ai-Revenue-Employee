/**
 * Reads widget configuration from the <script> tag that loaded the bundle.
 *
 *   <script src="https://host/widget.js" data-site-id="demo"
 *           data-backend="https://api.host" data-debug="true"
 *           data-legacy-engagement="false"></script>
 *
 * Defaults the backend to the origin that served widget.js, so the common case
 * needs only data-site-id.
 */
import type { WidgetConfig } from '../types.js';

function currentScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) return document.currentScript;
  // Fallback for async/deferred loads: find by filename.
  const scripts = Array.from(document.getElementsByTagName('script'));
  return scripts.find((s) => /widget\.js(\?|$)/.test(s.src)) ?? null;
}

function originFromSrc(src: string): string {
  try {
    return new URL(src).origin;
  } catch {
    return window.location.origin;
  }
}

export function readConfig(): WidgetConfig {
  const script = currentScript();
  const siteId = script?.getAttribute('data-site-id') ?? 'unknown';
  const backendAttr = script?.getAttribute('data-backend');
  const backendUrl = (backendAttr ?? (script ? originFromSrc(script.src) : window.location.origin)).replace(/\/$/, '');
  const debug = script?.getAttribute('data-debug') === 'true';
  const legacyEngagement = script?.getAttribute('data-legacy-engagement') === 'true';
  return { siteId, backendUrl, debug, legacyEngagement };
}
