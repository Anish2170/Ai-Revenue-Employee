/**
 * Deterministic behaviour summarizer.
 *
 * Converts the raw numeric {@link VisitorBehaviour} snapshot into a single
 * human-readable sentence that reasons better in an LLM prompt than bare
 * numbers do. This is PURE CODE — it must never call an LLM (that would double
 * cost/latency and defeat the rules engine).
 */
import type { VisitorBehaviour } from '../types.js';

function dwellPhrase(seconds: number): string {
  if (seconds >= 120) return 'spent over two minutes';
  if (seconds >= 60) return 'spent more than a minute';
  if (seconds >= 30) return 'spent about half a minute';
  if (seconds >= 10) return `spent ${Math.round(seconds)} seconds`;
  return 'only just arrived';
}

function scrollPhrase(depth: number): string {
  if (depth >= 90) return 'scrolled almost the entire page';
  if (depth >= 60) return 'scrolled through most of the page';
  if (depth >= 30) return 'scrolled partway down the page';
  return 'barely scrolled';
}

/**
 * Build a one-paragraph natural-language description of the visitor's session.
 *
 * @param b - the summarized behaviour snapshot.
 * @returns a description suitable for inclusion in an LLM prompt.
 */
export function summarize(b: VisitorBehaviour): string {
  const where = b.pageTitle ? `the "${b.pageTitle}" page (${b.page})` : `the page ${b.page}`;
  const parts: string[] = [`The visitor has ${dwellPhrase(b.timeOnPage)} on ${where} and ${scrollPhrase(b.scrollDepth)}.`];

  if (b.clickedElements.length > 0) {
    parts.push(`They clicked: ${b.clickedElements.join(', ')}.`);
  }

  parts.push(
    b.formInteracted
      ? 'They have started interacting with a form.'
      : 'They have not interacted with any contact form yet.',
  );

  if (b.mouseInactive >= 8) {
    parts.push(`They have been inactive for about ${Math.round(b.mouseInactive)} seconds, suggesting they may be reading or hesitating.`);
  }

  if (b.exitIntent) {
    parts.push('Their cursor moved toward the top of the window, suggesting they may be about to leave.');
  }

  const device = b.viewport.width < 768 ? 'a mobile device' : 'a desktop browser';
  parts.push(`They are browsing on ${device}.`);

  return parts.join(' ');
}
