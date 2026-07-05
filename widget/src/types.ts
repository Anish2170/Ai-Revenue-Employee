/**
 * Widget-side mirror of the backend contract. Kept deliberately small and
 * independent so the widget bundle has zero shared dependencies.
 */

export interface VisitorBehaviour {
  page: string;
  pageTitle: string;
  timeOnPage: number;
  scrollDepth: number;
  mouseInactive: number;
  clickedElements: string[];
  formInteracted: boolean;
  viewport: { width: number; height: number };
  exitIntent: boolean;
}

export interface SessionState {
  popupShown: boolean;
  lastEngageAt: number | null;
  engageCount: number;
  dismissed: boolean;
}

export interface EngageDecision {
  showPopup: boolean;
  intent?: string;
  confidence?: number;
  message?: string;
  cta?: string;
  /** Optional navigation target for the CTA (allowlisted server-side). */
  ctaUrl?: string;
  debug?: Record<string, unknown>;
}

export interface ChatSource {
  title: string;
  url: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  source?: ChatSource;
}

export interface WidgetConfig {
  /** Tenant id from data-site-id (forwarded for future multi-tenant use). */
  siteId: string;
  /** Backend base URL (defaults to the origin that served widget.js). */
  backendUrl: string;
  /** Whether to log widget diagnostics to the console. */
  debug: boolean;
  /**
   * Legacy automatic engagement is opt-in so it cannot accidentally call
   * /engage or show old proactive popups during Sprint 4.
   */
  legacyEngagement: boolean;
}

