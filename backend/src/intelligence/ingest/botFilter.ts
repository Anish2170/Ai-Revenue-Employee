/**
 * Bot filtering (§10.5).
 *
 * Cheap heuristics to drop non-human sessions BEFORE they cost us a perception
 * pass (and, in Sprint 4.2, an LLM call). This is a cost guard as much as a
 * data-quality one: bots must never trigger a decision.
 *
 * Deterministic and conservative — we only flag clear machine signatures, never
 * borderline-human traffic (a false "bot" would silence a real visitor).
 */
import type { SemanticEvent } from '../types.js';

export interface BotSignal {
  /** True when the widget reported navigator.webdriver (headless/automation). */
  webdriver?: boolean;
  /** The reported user-agent, if any. */
  userAgent?: string;
}

export interface BotVerdict {
  isBot: boolean;
  reason: string | null;
}

const BOT_UA = /(bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|selenium|curl|wget|python-requests)/i;

/**
 * Classify a session as bot/human from its accumulated events + client signals.
 *
 * @param events All accepted events this session (post event-quality).
 * @param signal Optional client-reported bot signals.
 */
export function classifyBot(events: readonly SemanticEvent[], signal: BotSignal = {}): BotVerdict {
  if (signal.webdriver === true) return { isBot: true, reason: 'webdriver' };
  if (signal.userAgent && BOT_UA.test(signal.userAgent)) return { isBot: true, reason: 'bot_user_agent' };

  // Need a few events before cadence is meaningful — under that, treat as human.
  if (events.length < 4) return { isBot: false, reason: null };

  const sorted = [...events].sort((a, b) => a.ts - b.ts);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i].ts - sorted[i - 1].ts);

  // Perfectly periodic cadence (near-zero variance) is a machine tell.
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (mean > 0) {
    const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
    const cv = Math.sqrt(variance) / mean; // coefficient of variation
    if (cv < 0.02 && gaps.length >= 4) return { isBot: true, reason: 'periodic_cadence' };
  }

  // Impossibly fast full traversal: many events within a tiny window.
  const span = sorted[sorted.length - 1].ts - sorted[0].ts;
  if (span < 300 && sorted.length >= 6) return { isBot: true, reason: 'burst_traversal' };

  return { isBot: false, reason: null };
}
