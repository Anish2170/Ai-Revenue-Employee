/**
 * Widget entry point. Loaded via:
 *   <script src="https://host/widget.js" data-site-id="demo"></script>
 *
 * Boots a single Orchestrator once the DOM is ready. Guards against double
 * injection. Keeps zero global footprint beyond one namespaced flag.
 */
import { readConfig } from './config/index.js';
import { Orchestrator } from './core/orchestrator.js';

declare global {
  interface Window {
    __aireLoaded?: boolean;
    Aire?: Orchestrator;
  }
}

function boot(): void {
  if (window.__aireLoaded) return;
  window.__aireLoaded = true;

  const cfg = readConfig();
  if (cfg.debug) {
    console.log('[AIRE] booting widget...');
    console.log('[AIRE] config:', JSON.stringify(cfg));
  }

  try {
    const instance = new Orchestrator(cfg);
    instance.start();
    window.Aire = instance;
    if (cfg.debug) console.log('[AIRE] widget started successfully');
  } catch (err) {
    console.error('[AIRE] failed to start', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
