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
import { NavigationObserver } from './navigation.js';
import type { WidgetIdentity } from '../api/client.js';
import { InterruptionSafety } from './interruptionSafety.js';
import { PopupDelivery } from '../popup/delivery.js';
import type { PopupPageContext } from '../types.js';
import { createId } from '../utils/id.js';

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
  private sessionId: string | null = null;
  private identity: WidgetIdentity | null = null;
  private started = false;
  private publicStartPromise: Promise<void> | null = null;
  private startupRetries = 0;
  private recoveryTimer: ReturnType<typeof window.setTimeout> | null = null;
  private navigationTimer: ReturnType<typeof window.setTimeout> | null = null;
  private pageVersion = 0;
  private pageInstanceId = createId();
  private pageStartedAt = 0;
  private acceptingPopup = false;
  private legacyRequest: AbortController | null = null;
  private legacyRetryAt = 0;
  private contextTimer: ReturnType<typeof window.setTimeout> | null = null;
  private readonly delivery = new PopupDelivery(this.cfg);
  private readonly safety = new InterruptionSafety(() => this.onSafetyChange());
  private readonly navigation = new NavigationObserver(() => this.onNavigation());

  constructor(private readonly cfg: WidgetConfig) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.mountUiShell();
    this.safety.start();
    this.navigation.start();
    window.addEventListener('online', this.recoverTransports);
    document.addEventListener('visibilitychange', this.recoverTransports);
    void this.startPublicTransports();
  }

  private startPublicTransports(): Promise<void> {
    if (this.publicStartPromise) return this.publicStartPromise;
    this.publicStartPromise = (async () => {
      try {
        const identity = await this.api?.getIdentity();
        if (identity) this.activateIdentity(identity);
        else this.scheduleRecovery();
      } catch { this.scheduleRecovery(); }
    })().finally(() => { this.publicStartPromise = null; });
    return this.publicStartPromise;
  }

  private activateIdentity(identity: WidgetIdentity): void {
    if (this.recoveryTimer !== null) window.clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.startupRetries = 0;
    if (this.sessionId !== identity.sessionId) this.renewSession(identity);
    if (this.cfg.legacyEngagement) this.startLegacyEngagement();
  }

  private scheduleRecovery(): void {
    if (this.recoveryTimer !== null || this.startupRetries >= 3) return;
    const delay = 500 * 2 ** this.startupRetries++;
    this.recoveryTimer = window.setTimeout(() => {
      this.recoveryTimer = null;
      void this.startPublicTransports();
    }, delay);
  }

  private recoverTransports = (): void => {
    if (document.visibilityState === 'hidden') return;
    if (this.identity) this.delivery.resume(this.identity);
    if (this.sensors) return;
    this.startupRetries = 0;
    void this.startPublicTransports();
  };

  private onNavigation(): void {
    const version = ++this.pageVersion;
    this.chat?.onNavigation();
    this.pageInstanceId = createId();
    this.pageStartedAt = Math.max(this.pageStartedAt + 1, Math.max(0, Date.now() - (this.identity?.sessionStartedAt ?? Date.now())));
    this.safety.navigate();
    this.sensors?.stop();
    this.sensors = null;
    this.dismissPopup();
    this.session?.resetForPage();
    if (this.navigationTimer !== null) window.clearTimeout(this.navigationTimer);
    // Let SPA render its new DOM before attaching element observers again.
    this.navigationTimer = window.setTimeout(() => {
      this.navigationTimer = null;
      if (version === this.pageVersion && this.identity && !this.sensors) this.startSensors(this.identity);
    }, 0);
  }

  private startAnalytics(identity: import('../api/client.js').WidgetIdentity): void {
    if (this.analytics) return;
    try {
      this.analytics = new AnalyticsTracker(this.cfg, identity);
      this.analytics.start();
    } catch (err) {
      this.analytics = null;
      this.log('analytics failed to start (non-fatal)', err);
    }
  }

  private renewSession(identity: import('../api/client.js').WidgetIdentity): void {
    this.identity = identity;
    this.sessionId = identity.sessionId;
    this.legacyRetryAt = 0;
    this.pageInstanceId = createId();
    this.pageStartedAt = Math.max(0, Date.now() - identity.sessionStartedAt);
    this.safety.renewSession();
    this.delivery.resume(identity);
    this.sensors?.stop();
    this.sensors = null;
    this.analytics?.stop();
    this.analytics = null;
    this.dismissPopup();
    this.session?.bind(identity.sessionId);
    this.startAnalytics(identity);
    this.startSensors(identity);
  }

  private mountUiShell(): void {
    if (this.root) return;

    this.root = createWidgetRoot();
    this.api = new ApiClient(this.cfg, identity => this.activateIdentity(identity), identity => this.activateIdentity(identity));
    this.session = this.session ?? new SessionManager(this.cfg.siteId);
    this.chat = new ChatWindow(
      this.root.layer,
      this.api,
      () => this.currentBehaviourSnapshot(),
      () => this.showLauncher(),
      {
        onOpen: () => { this.dismissPopup(); this.safety.setChatOpen(true); this.analytics?.track('CHAT', 'chat_opened', { flush: true }); },
        onClose: () => { this.safety.setChatOpen(false); this.analytics?.track('CHAT', 'chat_closed'); },
        onMessageSent: (detail) => this.analytics?.track('CHAT', 'message_sent', { numericValue: detail.length, flush: true }),
        onAiResponseCompleted: (detail) => this.analytics?.track('CHAT', 'ai_response_completed', { numericValue: detail.length, flush: true }),
        onSourceButtonClicked: (source) => this.analytics?.track('CHAT', 'source_button_clicked', { sourceTitle: source.title, sourceUrl: source.url, flush: true }),
      },
    );
    void this.chat.restoreLatest();
    this.showLauncher();
  }

  private currentBehaviourSnapshot(): VisitorBehaviour {
    const snapshot=this.tracker?.snapshot() ?? {
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
    return {...snapshot,page:(window.location.pathname||'/')+(window.location.search||''),pageTitle:document.title||''};
  }

  private startSensors(identity: import('../api/client.js').WidgetIdentity): void {
    try {
      this.sensors = new SensorEngine({
        siteId: this.cfg.siteId,
        backendUrl: this.cfg.backendUrl,
        identity,
        getIdentity: () => this.api!.getIdentity(),
        debug: this.cfg.debug,
        getClientState: () => this.eventsClientState(),
        getPageContext: () => this.popupPageContext(),
        onPopup: (popup) => { void this.onPipelinePopup(popup); },
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
    this.session = this.session ?? new SessionManager(this.cfg.siteId);
    this.tracker = new Tracker((reason) => this.onMilestone(reason));

    this.tracker.start();
    this.log('legacy engagement enabled');
  }

  private onMilestone(reason: MilestoneEvent): void {
    const session = this.session;
    if (!session) return;

    if (reason === 'navigation') {
      // The default navigation observer owns popup lifecycle in both modes.
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
    const sessionId = this.sessionId;
    const pageVersion = this.pageVersion;

    // Client-side gates (mirror the backend; keep cheap traffic off the wire).
    if (this.evaluating || chat.isOpen || this.popup) return;
    if (Date.now() < this.legacyRetryAt) return;
    if (s.popupShown || s.dismissed) return;
    if (this.safety.snapshot().blockedReason || this.safety.snapshot().formStalled) return;
    if (s.lastEngageAt && Date.now() - s.lastEngageAt < COOLDOWN_MS) return;

    this.evaluating = true;
    this.legacyRetryAt = Date.now() + COOLDOWN_MS;
    const behaviour = tracker.snapshot();
    // Send the PRE-evaluation session so the backend sees the prior timestamps.
    const controller = new AbortController();
    this.legacyRequest = controller;
    const deadline = window.setTimeout(() => controller.abort(), 13_000);
    const decision = await api.postEngage(behaviour, s, { page: this.popupPageContext(), clientState: this.eventsClientState(), signal: controller.signal });
    window.clearTimeout(deadline);
    this.legacyRequest = null;
    this.evaluating = false;
    if (sessionId !== this.sessionId || pageVersion !== this.pageVersion) return;

    this.log(`engage (${reason}) ->`, decision);
    if (decision.showPopup) {
      await this.onPipelinePopup(decision);
    }
  }

  private async onPipelinePopup(artifact: PopupArtifact | EngageDecision): Promise<void> {
    const meta = artifact.delivery;
    const identity = this.identity;
    // Requires the matching lifecycle backend; do not treat an old artifact as
    // an acknowledged candidate and silently bypass Phase 2 protections.
    if (!meta || !identity || this.acceptingPopup) return;
    const eligible = () => this.identity?.sessionId === identity.sessionId && this.pageInstanceId === meta.pageInstanceId
      && Date.now() < meta.expiresAt && this.safety.snapshot().version === meta.contextVersion
      && !this.safety.snapshot().blockedReason && this.safety.snapshot().formStalled === meta.formAssistance
      && !this.chat?.isOpen && !this.popup && !this.session?.get().dismissed && !this.session?.get().popupShown
      && (this.session?.get().engageCount ?? 0) < MAX_POPUPS_PER_SESSION;
    if (!eligible()) { this.delivery.notify('release', meta, identity); return; }
    this.acceptingPopup = true;
    try {
      const claimUntil = await this.delivery.claim(meta, identity, this.popupPageContext());
      if (!claimUntil || Date.now() >= claimUntil || !eligible()) { this.delivery.notify('release', meta, identity); return; }
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
        ctaUrl: 'ctaUrl' in artifact ? artifact.ctaUrl : undefined,
        delivery: meta,
      };
      this.log('[popup-trace] stage=9_popup_delivery_to_widget artifact_received', { passed: true, popupGenerated: true, popupType: artifact.popupType });
      if (!this.showPopup(decision)) this.delivery.notify('release', meta, identity);
    } catch { this.delivery.notify('release', meta, identity); }
    finally { this.acceptingPopup = false; }
  }

  private showPopup(decision: EngageDecision): boolean {
    const root = this.root;
    const session = this.session;
    const chat = this.chat;
    if (!root || !session || !chat) {
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'ui_not_ready', popupGenerated: false });
      return false;
    }

    const s = session.get();
    const safety = this.safety.snapshot();
    if (safety.blockedReason || (safety.formStalled && !decision.delivery?.formAssistance)) return false;
    if (!decision.showPopup) {
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'decision_showPopup_false', popupGenerated: false });
      return false;
    }
    if (this.popup || chat.isOpen) {
      this.log('popup_suppressed', { reason: this.popup ? 'popup_active' : 'chat_open' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: this.popup ? 'popup_active' : 'chat_open', popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: this.popup ? 'popup_active' : 'chat_open' });
      return false;
    }
    if (s.popupShown || s.dismissed) {
      this.log('popup_suppressed', { reason: s.dismissed ? 'dismissed' : 'already_shown' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: s.dismissed ? 'dismissed' : 'already_shown', popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: s.dismissed ? 'dismissed' : 'already_shown' });
      return false;
    }
    if (s.engageCount >= MAX_POPUPS_PER_SESSION) {
      this.log('popup_suppressed', { reason: 'frequency_budget' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'frequency_budget', popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: 'frequency_budget' });
      return false;
    }
    if (s.lastEngageAt && Date.now() - s.lastEngageAt < COOLDOWN_MS) {
      this.log('popup_suppressed', { reason: 'cooldown' });
      this.log('[popup-trace] stage=10_widget_rendering', { passed: false, reason: 'cooldown', cooldownRemainingMs: Math.max(0, COOLDOWN_MS - (Date.now() - s.lastEngageAt)), popupGenerated: true });
      this.analytics?.track('POPUP', 'popup_suppressed', { reason: 'cooldown' });
      return false;
    }

    const receiptIdentity = this.identity;
    this.popup = renderPopup(root.layer, decision, {
      onCta: (clickedAction) => {
        const actionId = clickedAction?.actionId ?? decision.action?.actionId ?? decision.primaryAction;
        this.log('popup_clicked', {
          popupType: decision.popupType ?? null,
          tone: decision.tone ?? null,
          actionId: actionId ?? null,
        });
        if (decision.delivery && receiptIdentity) this.delivery.notify('clicked', decision.delivery, receiptIdentity);
        else this.analytics?.track('POPUP', 'popup_clicked', { popupType: decision.popupType, label: decision.tone, actionId, flush: true });
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
        if (decision.delivery && receiptIdentity) this.delivery.notify('dismissed', decision.delivery, receiptIdentity);
        else this.analytics?.track('POPUP', 'popup_dismissed', { popupType: decision.popupType, label: decision.tone, flush: true });
        this.popup = null;
        session.markDismissed();
        this.showLauncher();
      },
    });
    // Counters and receipt follow successful DOM insertion, never generation.
    session.markEngaged();
    session.markPopupShown();
    this.log('popup_displayed', { popupType: decision.popupType ?? null, tone: decision.tone ?? null });
    if (!decision.delivery) this.analytics?.track('POPUP', 'popup_displayed', { popupType: decision.popupType, label: decision.tone, actionId: decision.primaryAction ?? decision.action?.actionId, flush: true });
    this.log('[popup-trace] stage=10_widget_rendering', { passed: true, popupGenerated: true, popupType: decision.popupType, title: decision.title });
    if (decision.delivery && receiptIdentity) this.delivery.notify('displayed', decision.delivery, receiptIdentity);
    // Keep the persistent launcher visible, sitting just below the popup card.
    if (this.launcher) root.layer.appendChild(this.launcher);
    return true;
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
      safety: this.safety.snapshot(),
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
    this.popup?.remove(true);
    this.popup = null;
    // Also remove a card still finishing its dismissal animation before chat.
    this.root?.layer.querySelectorAll?.('.aire-popup').forEach(node => node.remove());
  }

  private openChat(opener?: string): void {
    this.dismissPopup();
    this.safety.setChatOpen(true);
    this.hideLauncher();
    void this.chat?.open(opener);
  }

  private popupPageContext(): PopupPageContext {
    return { pageInstanceId: this.pageInstanceId, pageStartedAt: this.pageStartedAt, ...this.safety.snapshot() };
  }

  private onSafetyChange(): void {
    const legacyPending = this.legacyRequest !== null;
    this.legacyRequest?.abort();
    const pending = this.sensors?.cancelPending();
    if (this.safety.snapshot().blockedReason) this.dismissPopup();
    // Context changes invalidate old generation even if no semantic batch is due.
    if ((pending || legacyPending || this.acceptingPopup) && this.contextTimer === null) this.contextTimer = window.setTimeout(() => {
      this.contextTimer = null;
      if (this.identity) this.delivery.context(this.identity, this.popupPageContext());
    }, 150);
    this.sensors?.requestOpportunity();
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
