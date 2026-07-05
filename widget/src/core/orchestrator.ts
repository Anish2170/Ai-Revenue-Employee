/**
 * Orchestrator - the widget's state machine.
 *
 * Sprint 4 streams semantic events to /events while keeping the old
 * tracker-driven /engage popup automation disabled by default. The persistent
 * launcher is mounted independently so the widget shell still appears.
 */
import type { WidgetConfig, EngageDecision, VisitorBehaviour } from '../types.js';
import { ApiClient } from '../api/client.js';
import { SessionManager } from '../session/state.js';
import { Tracker, type MilestoneEvent } from '../tracker/state.js';
import { createWidgetRoot, type WidgetRoot } from '../ui/root.js';
import { renderPopup, type PopupHandle } from '../popup/popup.js';
import { ChatWindow } from '../chat/chat.js';
import { el } from '../utils/dom.js';
import { SensorEngine } from '../sensors/index.js';

/** Client-side cooldown, mirrors the backend policy to avoid wasteful calls. */
const COOLDOWN_MS = 25_000;

const CHAT_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>';

export class Orchestrator {
  private root: WidgetRoot | null = null;
  private api: ApiClient | null = null;
  private session: SessionManager | null = null;
  private tracker: Tracker | null = null;
  private chat: ChatWindow | null = null;
  private popup: PopupHandle | null = null;
  private launcher: HTMLButtonElement | null = null;
  private evaluating = false;
  private sensors: SensorEngine | null = null;

  constructor(private readonly cfg: WidgetConfig) {}

  start(): void {
    this.mountUiShell();

    // Sprint 4.1 (shadow mode): stream semantic events to POST /events for the
    // backend perception loop. Fully isolated so sensor failure cannot affect
    // the host page or the legacy engagement path.
    this.startSensors();

    if (this.cfg.legacyEngagement) {
      this.startLegacyEngagement();
    } else {
      this.log('perception-only shadow mode active; legacy engagement disabled');
    }

    this.log('widget started', this.cfg);
  }

  private mountUiShell(): void {
    if (this.root) return;

    this.root = createWidgetRoot();
    this.api = new ApiClient(this.cfg);
    this.chat = new ChatWindow(
      this.root.layer,
      this.api,
      () => this.currentBehaviourSnapshot(),
      () => this.showLauncher(),
    );
    this.showLauncher();
  }

  private currentBehaviourSnapshot(): VisitorBehaviour {
    return this.tracker?.snapshot() ?? {
      page: window.location.pathname || '/',
      pageTitle: document.title || '',
      timeOnPage: 0,
      scrollDepth: 0,
      mouseInactive: 0,
      clickedElements: [],
      formInteracted: false,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      exitIntent: false,
    };
  }

  private startSensors(): void {
    try {
      this.sensors = new SensorEngine({
        siteId: this.cfg.siteId,
        backendUrl: this.cfg.backendUrl,
        debug: this.cfg.debug,
      });
      this.sensors.start();
    } catch (err) {
      this.sensors = null;
      this.log('sensor engine failed to start (non-fatal)', err);
    }
  }

  /**
   * Legacy Sprint 1-3 automatic engagement. Kept opt-in during Sprint 4 so
   * tracker-driven /engage and showPopup cannot accidentally reach visitors.
   */
  private startLegacyEngagement(): void {
    if (this.tracker) return;

    this.mountUiShell();
    this.session = new SessionManager();
    this.tracker = new Tracker((reason) => this.onMilestone(reason));

    this.tracker.start();
    this.log('legacy engagement enabled');
  }

  private onMilestone(reason: MilestoneEvent): void {
    const session = this.session;
    if (!session) return;

    if (reason === 'navigation') {
      session.resetForPage();
      this.dismissPopup();
      this.log('navigation -> state reset');
      return;
    }
    void this.tryEngage(reason);
  }

  private async tryEngage(reason: MilestoneEvent): Promise<void> {
    const session = this.session;
    const api = this.api;
    const tracker = this.tracker;
    const chat = this.chat;
    if (!session || !api || !tracker || !chat) return;

    const s = session.get();

    // Client-side gates (mirror the backend; keep cheap traffic off the wire).
    if (this.evaluating || chat.isOpen || this.popup) return;
    if (s.popupShown || s.dismissed) return;
    if (s.lastEngageAt && Date.now() - s.lastEngageAt < COOLDOWN_MS) return;

    this.evaluating = true;
    const behaviour = tracker.snapshot();
    // Send the PRE-evaluation session so the backend sees the prior timestamps.
    const decision = await api.postEngage(behaviour, s);
    session.markEngaged();
    this.evaluating = false;

    this.log(`engage (${reason}) ->`, decision);
    if (decision.showPopup) this.showPopup(decision);
  }

  private showPopup(decision: EngageDecision): void {
    const root = this.root;
    const session = this.session;
    if (!root || !session) return;

    session.markPopupShown();
    this.popup = renderPopup(root.layer, decision, {
      onCta: () => {
        this.popup = null;
        // If the backend supplied an (allowlisted) navigation target, go there;
        // otherwise open the chat, seeded with the popup's message so the
        // conversation continues with context already in place.
        if (decision.ctaUrl && this.navigate(decision.ctaUrl)) return;
        this.openChat(decision.message);
      },
      onDismiss: () => {
        this.popup = null;
        session.markDismissed();
        this.showLauncher();
      },
    });
    // Keep the persistent launcher visible, sitting just below the popup card.
    if (this.launcher) root.layer.appendChild(this.launcher);
  }

  private dismissPopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  private openChat(opener?: string): void {
    this.hideLauncher();
    this.chat?.open(opener);
  }

  /**
   * Navigate the visitor to a CTA target. The backend already allowlists the url
   * to the site's own links; this is a second, client-side guard that only
   * permits relative paths or http(s) - blocking javascript:/data: and similar.
   * @returns true if navigation was initiated.
   */
  private navigate(url: string): boolean {
    const isRelative = url.startsWith('/') && !url.startsWith('//');
    let safe = isRelative;
    if (!safe) {
      try {
        const proto = new URL(url, window.location.origin).protocol;
        safe = proto === 'http:' || proto === 'https:';
      } catch {
        safe = false;
      }
    }
    if (!safe) {
      this.log('blocked unsafe ctaUrl', url);
      return false;
    }
    this.log('navigating to', url);
    window.location.assign(url);
    return true;
  }

  private showLauncher(): void {
    const root = this.root;
    const chat = this.chat;
    if (!root || !chat || this.launcher || chat.isOpen) return;

    const btn = el('button', 'aire-launcher') as HTMLButtonElement;
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = CHAT_SVG;
    btn.addEventListener('click', () => this.openChat());
    root.layer.appendChild(btn);
    this.launcher = btn;
  }

  private hideLauncher(): void {
    this.launcher?.remove();
    this.launcher = null;
  }

  private log(...args: unknown[]): void {
    if (this.cfg.debug) console.log('[AIRE]', ...args);
  }
}

