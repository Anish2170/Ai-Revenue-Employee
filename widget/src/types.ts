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

export interface PopupArtifact {
  title: string;
  body: string;
  cta: string;
  popupType: string;
  tone: string;
}

export interface EngageDecision {
  showPopup: boolean;
  intent?: string;
  confidence?: number;
  message?: string;
  title?: string;
  body?: string;
  cta?: string;
  popupType?: string;
  tone?: string;
  /** Optional navigation target for the CTA (allowlisted server-side). */
  ctaUrl?: string;
  debug?: Record<string, unknown>;
}

export interface EventsClientState {
  popupShown: boolean;
  lastPopupAt: number | null;
  dismissed: boolean;
  chatOpen: boolean;
  popupActive: boolean;
  popupCount: number;
}

export interface EventsResponse {
  status: 'ack' | 'bot' | 'ignored';
  popup?: PopupArtifact;
}

export interface ChatSource {
  title: string;
  url: string;
}

export interface ChatConversationMeta {
  id: string;
  title: string;
  titleStatus: string;
  status?: string;
  lastMessageAt?: string;
  startedAt?: string;
  totalMessages?: number;
  summary?: string | null;
}

export interface WidgetConversation extends ChatConversationMeta {
  messages: Array<ChatMessage & { id?: string; timestamp?: string }>;
  memories?: Array<{ id: string; kind: string; content: string; confidence: number | null }>;
}

export interface WidgetConversationResponse {
  conversation: WidgetConversation;
  conversations: ChatConversationMeta[];
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

