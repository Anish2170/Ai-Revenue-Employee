/**
 * Shared domain types for the AI Revenue Employee backend.
 *
 * These describe the contract between the widget (client) and the backend.
 * The widget is a dumb client: it sends a summarized {@link VisitorBehaviour}
 * snapshot plus its own {@link SessionState}, and renders whatever decision
 * the backend returns. All intelligence lives here.
 */

/**
 * A summarized snapshot of one visitor's behaviour on the current page.
 * The widget aggregates raw browser events into this shape before sending it —
 * the backend never sees individual mouse/scroll events.
 */
export interface VisitorBehaviour {
  /** Current page path, e.g. "/pricing". */
  page: string;
  /** Document title at snapshot time. */
  pageTitle: string;
  /** Seconds spent on the current page. */
  timeOnPage: number;
  /** Furthest scroll depth reached, as a percentage 0–100. */
  scrollDepth: number;
  /** Seconds since the last meaningful mouse/keyboard activity. */
  mouseInactive: number;
  /** Stable identifiers of notable elements the visitor clicked. */
  clickedElements: string[];
  /** Whether the visitor focused/typed into any form field. */
  formInteracted: boolean;
  /** Viewport size at snapshot time. */
  viewport: { width: number; height: number };
  /** Whether exit intent (cursor leaving toward the top) was detected. */
  exitIntent: boolean;
}

/**
 * Per-visitor counters owned by the widget for this browsing session.
 *
 * Sprint 1 has no database, so the rules engine is stateless and trusts these
 * client-provided counters. Sprint 2 moves this server-side behind the same
 * rules-engine interface.
 */
export interface SessionState {
  /** Whether a popup has already been shown this session. */
  popupShown: boolean;
  /** Epoch ms of the last /engage evaluation, or null if none yet. */
  lastEngageAt: number | null;
  /** How many times /engage has been called this session. */
  engageCount: number;
  /** Whether the visitor explicitly dismissed a popup. */
  dismissed: boolean;
}

/** The structured engagement decision returned to the widget. */
export interface EngageDecision {
  /** Whether the widget should render a popup. */
  showPopup: boolean;
  /** Machine-readable intent label, e.g. "pricing_interest". */
  intent?: string;
  /** Model confidence, clamped to 0–1. */
  confidence?: number;
  /** The popup body text. Rendered as textContent (never innerHTML). */
  message?: string;
  /** Call-to-action label for the popup button. */
  cta?: string;
  /**
   * Optional navigation target for the CTA. When present, clicking the CTA
   * navigates here instead of opening chat. Always one of the site's allowlisted
   * links (validated server-side) — never an arbitrary URL.
   */
  ctaUrl?: string;
  /** Dev-only decision trace; omitted in production. */
  debug?: DecisionTrace;
}

/** Dev-only diagnostics attached to an {@link EngageDecision}. */
export interface DecisionTrace {
  /** Which rule path produced this decision. */
  ruleMatched: string;
  /** Whether the LLM was actually invoked. */
  llmCalled: boolean;
  /** Human-readable explanation of the decision. */
  reason: string;
  /** Version id of the prompt that generated the message, if any. */
  promptVersion?: string;
  /** Whether knowledge came from the RAG index or the static fallback. */
  knowledgeSource?: 'rag' | 'fallback';
  /** Similarity scores of the retrieved chunks (when RAG was used). */
  retrievalScores?: number[];
  /** Total pipeline processing time in milliseconds. */
  processingTimeMs: number;
}

/** A single chat turn. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A single frequently-asked question and its answer. */
export interface BusinessFAQ {
  q: string;
  a: string;
}

/**
 * A navigable destination on the customer's site. The AI may only direct a
 * visitor to one of these (allowlisted) — it can never invent a URL. `url` is
 * typically a relative path (e.g. "/book-demo") so it works on any host.
 */
export interface SiteLink {
  /** Human label, e.g. "Book a demo". */
  label: string;
  /** Relative path or absolute URL, e.g. "/book-demo". */
  url: string;
}

/** Business knowledge injected into prompts. Sourced via the Context Provider. */
export interface BusinessContext {
  name: string;
  description: string;
  services: string[];
  /** Optional extra free-form guidance for the assistant's tone/policy. */
  tone?: string;
  /** One-line positioning / hero value proposition. */
  positioning?: string;
  /** Short, human-readable summary of pricing plans. */
  pricingSummary?: string;
  /** Curated FAQs the assistant can answer from (kept small for token cost). */
  faqs?: BusinessFAQ[];
  /** How a visitor can get in touch / book a call. */
  contact?: string;
  /** Navigable site destinations the AI may send a visitor to (allowlisted). */
  siteLinks?: SiteLink[];
}
