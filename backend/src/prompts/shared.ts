/**
 * Shared prompt-rendering helpers used by both the engage and chat builders so
 * the RAG context is presented to Gemini consistently.
 */
import type { BusinessInstructions, RetrievedChunk } from '../context/types.js';
import type { SiteLink } from '../types.js';

/** Render the retrieved knowledge chunks as a clearly-delimited block. */
export function renderKnowledge(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return 'BUSINESS KNOWLEDGE:\n(none retrieved — do not fabricate details; offer to connect the visitor with the team.)';
  }
  const body = chunks
    .map((c, i) => `[${i + 1}] (${c.pageType} — ${c.heading})\n${c.content}`)
    .join('\n\n');
  return `BUSINESS KNOWLEDGE (use ONLY these facts; do not invent beyond them):\n${body}`;
}

/** Render owner instructions as explicit behavioural directives. */
export function renderInstructions(ins: BusinessInstructions): string {
  const lines = [`Tone: ${ins.tone}`, `Respond in: ${ins.language}.`];
  if (ins.alwaysBookDemo) lines.push('When there is buying intent, steer the visitor toward booking a demo or contacting the team.');
  if (ins.avoidDiscounts) lines.push('NEVER offer, invent, or imply discounts, coupons, or special deals.');
  return `BUSINESS INSTRUCTIONS:\n- ${lines.join('\n- ')}`;
}

/** Render the navigable site links (CTA allowlist). */
export function renderSiteLinks(links: SiteLink[]): string {
  if (links.length === 0) return '';
  return ['Site links (the ONLY urls you may use; copy one exactly):', ...links.map((l) => `- ${l.label} -> ${l.url}`)].join('\n');
}
