/**
 * Zod schemas for inbound request bodies. These validate what the widget sends
 * before any service logic runs (the `validate` middleware uses them).
 */
import { z } from 'zod';

export const visitorBehaviourSchema = z.object({
  page: z.string().max(2048).default('/'),
  pageTitle: z.string().max(512).default(''),
  timeOnPage: z.number().nonnegative().max(86_400).default(0),
  scrollDepth: z.number().min(0).max(100).default(0),
  mouseInactive: z.number().nonnegative().max(86_400).default(0),
  clickedElements: z.array(z.string().max(200)).max(50).default([]),
  formInteracted: z.boolean().default(false),
  viewport: z
    .object({ width: z.number().nonnegative().max(20_000), height: z.number().nonnegative().max(20_000) })
    .default({ width: 0, height: 0 }),
  exitIntent: z.boolean().default(false),
});

export const sessionStateSchema = z.object({
  popupShown: z.boolean().default(false),
  lastEngageAt: z.number().nullable().default(null),
  engageCount: z.number().int().nonnegative().max(10_000).default(0),
  dismissed: z.boolean().default(false),
});

export const engageRequestSchema = z.object({
  siteId: z.string().max(100).optional(),
  behaviour: visitorBehaviourSchema,
  session: sessionStateSchema.default({
    popupShown: false,
    lastEngageAt: null,
    engageCount: 0,
    dismissed: false,
  }),
});

export const chatSourceSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().max(2048),
});

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
  source: chatSourceSchema.optional(),
});

export const chatRequestSchema = z.object({
  siteId: z.string().max(100).optional(),
  conversationId: z.string().uuid().optional(),
  visitorId: z.string().max(100).optional(),
  sessionId: z.string().max(100).optional(),
  messages: z.array(chatMessageSchema).min(1).max(50),
  behaviour: visitorBehaviourSchema.optional(),
});

export type EngageRequest = z.infer<typeof engageRequestSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
