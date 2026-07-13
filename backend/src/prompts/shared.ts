/**
 * Shared prompt-rendering helpers used by both the engage and chat builders so
 * the RAG context is presented to Gemini consistently.
 */
import type { BusinessInstructions, RetrievedChunk } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
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
  const lines = [
    `Business name: ${ins.businessName}`,
    ins.companyDescription ? `Company description: ${ins.companyDescription}` : '',
    ins.role ? `Assistant role: ${ins.role}` : '',
    `Tone: ${ins.tone}`,
    ins.goal ? `Primary goal: ${ins.goal}` : '',
    ins.context ? `Additional context: ${ins.context}` : '',
    ins.rules ? `Owner rules: ${ins.rules}` : '',
    ins.fallbackMessage ? `Fallback message: ${ins.fallbackMessage}` : '',
    `Respond in: ${ins.language}.`,
    ins.websiteUrl ? `Website URL: ${ins.websiteUrl}` : '',
  ].filter(Boolean);
  if (ins.alwaysBookDemo) lines.push('When there is buying intent, steer the visitor toward booking a demo or contacting the team.');
  if (ins.avoidDiscounts) lines.push('NEVER offer, invent, or imply discounts, coupons, or special deals.');
  return `BUSINESS INSTRUCTIONS:\n- ${lines.join('\n- ')}`;
}
/** Render the navigable site links (CTA allowlist). */
export function renderSiteLinks(links: SiteLink[]): string {
  if (links.length === 0) return '';
  return ['Site links (the ONLY urls you may use; copy one exactly):', ...links.map((l) => `- ${l.label} -> ${l.url}`)].join('\n');
}

/** Render enabled business-owned actions. The AI may choose IDs only; destinations stay out of the prompt. */
export function renderBusinessActions(actions: BusinessActionConfig[]): string {
  if (actions.length === 0) return 'Available Actions: none. Do not include primaryAction or secondaryAction.';
  return [
    'Available Actions (choose only these Action IDs; never invent action IDs, URLs, phone numbers, email addresses, or WhatsApp numbers):',
    ...actions.map((action) => `- ${action.actionId}: ${action.label}`),
  ].join('\n');
}
