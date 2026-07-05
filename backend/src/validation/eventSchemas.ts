/**
 * Zod schema for the POST /events request body (Sprint 4.1).
 *
 * This is the wire contract for the widget's batched semantic-event feed. It is
 * intentionally permissive on the array contents (max lengths, coercion) because
 * the intelligence-layer event-quality pass (§10.4) does the real semantic
 * validation — this schema only guards the envelope and caps sizes.
 */
import { z } from 'zod';

/** A single raw event as sent by the widget. Kept loose; cleaned at ingest. */
export const rawEventSchema = z.object({
  type: z.string().max(40),
  zone: z.string().max(40),
  intensity: z.number().default(0.5),
  ts: z.number(),
  surface: z.string().max(16).optional(),
});

export const eventsClientStateSchema = z.object({
  /** Client-side popup has already been shown on this page. */
  popupShown: z.boolean().default(false),
  /** Epoch ms of the last visitor-visible popup display. */
  lastPopupAt: z.number().nullable().optional(),
  /** Visitor dismissed the popup in this browser session. */
  dismissed: z.boolean().default(false),
  /** Chat is currently open; never interrupt an active conversation. */
  chatOpen: z.boolean().default(false),
  /** A popup is currently visible; never stack popups. */
  popupActive: z.boolean().default(false),
  /** Client-side interruption count, used only as an extra suppression guard. */
  popupCount: z.number().int().nonnegative().max(10_000).default(0),
}).partial();

export const eventsRequestSchema = z.object({
  /** Public tenant handle (optional in dev-fallback). */
  siteId: z.string().max(100).optional(),
  /** Anonymous, widget-generated first-party session id. */
  sessionId: z.string().min(8).max(128),
  /** Whether this is a returning visitor (first-party token present). */
  returning: z.boolean().default(false),
  /** The batched semantic events. Bounded to protect the ingest path. */
  events: z.array(rawEventSchema).max(100).default([]),
  /** Dominant surface for the session (tuning constant only). */
  surface: z.enum(['desktop', 'mobile', 'tablet']).default('desktop'),
  /** Optional client UI state so production /events can preserve suppression rules. */
  clientState: eventsClientStateSchema.optional(),
  /** Optional bot signals from the client (navigator.webdriver, UA). */
  botSignal: z
    .object({
      webdriver: z.boolean().optional(),
      userAgent: z.string().max(512).optional(),
    })
    .optional(),
});

export type EventsRequest = z.infer<typeof eventsRequestSchema>;
