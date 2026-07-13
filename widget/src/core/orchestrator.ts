/**
 * Orchestrator - the widget's state machine.
 *
 * Sprint 4 streams semantic events to /events while keeping the old
 * tracker-driven /engage popup automation disabled by default. The persistent
 * launcher is mounted independently so the widget shell still appears.
 */
import type { WidgetConfig, BusinessActionConfig, EngageDecision, EventsClientState, PopupArtifact, VisitorBehaviour } from '../types.js';
import { ApiClient } from '../api/client.js';
import { SessionManager } from '../session/state.js';
import { Tracker, type MilestoneEvent } from '../tracker/state.js';
import { createWidgetRoot, type WidgetRoot } from '../ui/root.js';
import { renderPopup, type PopupHandle } from '../popup/popup.js';
import { ChatWindow } from '../chat/chat.js';
import { el } from '../utils/dom.js';
import { SensorEngine } from '../sensors/index.js';
import { AnalyticsTracker } from '../analytics/analytics.js';

/** Client-side cooldown, mirrors the backend policy to avoid wasteful calls. */
const COOLDOWN_MS = 25_000;
const MAX_POPUPS_PER_SESSION = 2;

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
  private analytics: AnalyticsTracker | null = null;

  constructor(private readonly cfg: WidgetConfig) {}

  start(): void {
    this.startAnalytics();
    this.mountUiShell();
    this.analytics?.track('WIDGET', 'widget_initialized');

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

  private startAnalytics(): void {
    if (this.analytics) return;
    try {
      this.analytics = new AnalyticsTracker(this.cfg);
      this.analytics.start();
    } catch (err) {
      this.analytics = null;
      this.log('analytics failed to start (non-fatal)', err);
    }
  }

  private mountUiShell(): void {
    if (this.root) return;

    this.root = createWidgetRoot();
    this.api = new ApiClient(this.cfg);
    this.session = this.session ?? new SessionManager();
    this.chat = new ChatWindow(
      this.root.layer,
      this.api,
      () => this.currentBehaviourSnapshot(),
      () => this.showLauncher(),
      {
        onOpen: () => this.analytics?.track('CHAT', 'chat_opened', { flush: true }),
        onClose: () => this.analytics?.track('CHAT', 'chat_closed'),
        onMessageSent: (detail) => this.analytics?.track('CHAT', 'message_sent', { numericValue: detail.length, flush: true }),
        onAiResponseCompleted: (detail) => this.analytics?.track('CHAT', 'ai_response_completed', { numericValue: detail.length, flush: true }),
        onSourceButtonClicked: (source) => this.analytics?.track('CHAT', 'source_button_clicked', { sourceTitle: source.title, sourceUrl: source.url, flush: true }),
      },
    );
    void this.chat.restoreLatest();
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
        getClientState: () => this.eventsClientState(),
        onPopup: (popup) => this.onPipelinePopup(popup),
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
    this.session = this.session ?? new SessionManager();
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
    this.evaluating = false;

    this.log(`engage (${reason}) ->`, decision);
    if (decision.showPopup) {
      this.showPopup(decision);
    } else {
      session.markEngaged();
    }
  }

  private onPipelinePopup(artifact: PopupArtifact): void {
    const decision: EngageDecision = {
      showPopup: true,
      title: artifact.title,
      body: artifact.body,
      message: artifact.body,
      cta: artifact.cta,
      primaryAction: artifact.primaryAction,
      secondaryAction: artifact.secondaryAction,
      action: artifact.action,
      secondaryActionConfig: artifact.secondaryActionConfig,
      popupType: artifact.popupType,
      tone: artifact.tone,
    };
    this.log('[popup-trace] stage=9_popup_delivery_to_widget artifact_received', { passed: true, popupGenerated: true, popupType: artifact.popupType });
    this.showPopup(decision);
  }

  private showPopup(decision: EngageDecision): void {
    const root = this.root;
    const session = this.session;
    const chat = this.chat;
    if (!root || !session || !chat) {
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'ui_not_ready', popupGenerated: false });
      return;
    }

    const s = session.get();
    if (!decision.showPopup) {
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'decision_showPopup_false', popupGenerated: false });
      return;
    }
    if (this.popup || chat.isOpen) {
      this.log('popup_suppressed', { reason: this.popup ? 'popup_active' : 'chat_open' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: this.popup ? 'popup_active' : 'chat_open', popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: this.popup ? 'popup_active' : 'chat_open' });
      return;
    }
    if (s.popupShown || s.dismissed) {
      this.log('popup_suppressed', { reason: s.dismissed ? 'dismissed' : 'already_shown' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: s.dismissed ? 'dismissed' : 'already_shown', popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: s.dismissed ? 'dismissed' : 'already_shown' });
      return;
    }
    if (s.engageCount >= MAX_POPUPS_PER_SESSION) {
      this.log('popup_suppressed', { reason: 'frequency_budget' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'frequency_budget', popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: 'frequency_budget' });
      return;
    }
    if (s.lastEngageAt && Date.now() - s.lastEngageAt < COOLDOWN_MS) {
      this.log('popup_suppressed', { reason: 'cooldown' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'cooldown', cooldownRemainingMs: Math.max(0, COOLDOWN_MS - (Date.now() - s.lastEngageAt)), popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: 'cooldown' });
      return;
    }

    session.markEngaged();
    session.markPopupShown();
    this.log('popup_displayed', {
      popupType: decision.popupType ?? null,
      tone: decision.tone ?? null,
    });
    this.analytics?.track('POPUP', 'popup_displayed', { popupType: decision.popupType, label: decision.tone, actionId: decision.primaryAction ?? decision.action?.actionId, flush: true });
    this.log('[popup-trace] stage=10_widget_rendering', { passed: true, popupGenerated: true, popupType: decision.popupType, title: decision.title });
    this.popup = renderPopup(root.layer, decision, {
      onCta: (clickedAction) => {
        const actionId = clickedAction?.actionId ?? decision.action?.actionId ?? decision.primaryAction;
        this.log('popup_clicked', {
          popupType: decision.popupType ?? null,
          tone: decision.tone ?? null,
          actionId: actionId ?? null,
        });
        this.analytics?.track('POPUP', 'popup_clicked', { popupType: decision.popupType, label: decision.tone, actionId, flush: true });
        if (actionId) this.analytics?.track('POPUP', `${actionId}_clicked`, { popupType: decision.popupType, actionId, flush: true });
        this.popup = null;
        if (clickedAction && this.executeBusinessAction(clickedAction, decision.title ?? clickedAction.label ?? decision.body ?? decision.message)) return;
        if (decision.ctaUrl && this.navigate(decision.ctaUrl)) return;
        if (decision.cta) this.openChat(decision.title ?? decision.cta ?? decision.body ?? decision.message);
      },
      onDismiss: () => {
        this.log('popup_dismissed', {
          popupType: decision.popupType ?? null,
          tone: decision.tone ?? null,
        });
        this.analytics?.track('POPUP', 'popup_dismissed', { popupType: decision.popupType, label: decision.tone, flush: true });
        this.popup = null;
        session.markDismissed();
        this.showLauncher();
      },
    });
    // Keep the persistent launcher visible, sitting just below the popup card.
    if (this.launcher) root.layer.appendChild(this.launcher);
  }

  private eventsClientState(): EventsClientState {
    const s = this.session?.get() ?? {
      popupShown: false,
      lastEngageAt: null,
      engageCount: 0,
      dismissed: false,
    };
    return {
      popupShown: s.popupShown,
      lastPopupAt: s.lastEngageAt,
      dismissed: s.dismissed,
      chatOpen: this.chat?.isOpen ?? false,
      popupActive: this.popup !== null,
      popupCount: s.engageCount,
    };
  }

  private executeBusinessAction(action: BusinessActionConfig, opener?: string): boolean {
    if (!action || !action.enabled) return false;
    if (action.destinationType === 'CHAT') {
      this.openChat(opener ?? action.label);
      return true;
    }
    const destination = normalizeActionDestination(action.destinationType, action.destination);
    if (!destination) {
      this.log('missing business action destination', action.actionId);
      return false;
    }
    return this.navigate(destination, action.destinationType);
  }
  private dismissPopup(): void {
    this.popup?.remove();
    this.popup = null;
  }

  private openChat(opener?: string): void {
    this.hideLauncher();
    void this.chat?.open(opener);
  }

  /**
   * Navigate the visitor to a CTA target. The backend already allowlists the url
   * to the site's own links; this is a second, client-side guard that only
   * permits relative paths or http(s) - blocking javascript:/data: and similar.
   * @returns true if navigation was initiated.
   */
  private navigate(url: string, destinationType: string = 'URL'): boolean {
    const isRelative = url.startsWith('/') && !url.startsWith('//');
    let safe = isRelative;
    if (!safe) {
      try {
        const proto = new URL(url, window.location.origin).protocol;
        safe = proto === 'http:' || proto === 'https:' || proto === 'tel:' || proto === 'mailto:';
      } catch {
        safe = false;
      }
    }
    if (!safe) {
      this.log('blocked unsafe action destination', url);
      return false;
    }
    this.log('executing action destination', { destinationType, url });
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


function normalizeActionDestination(type: string, destination: string): string | null {
  const value = destination.trim();
  if (!value) return null;
  if (type === 'PHONE') return value.startsWith('tel:') ? value : `tel:${value}`;
  if (type === 'EMAIL') return value.startsWith('mailto:') ? value : `mailto:${value}`;
  return value;
}
