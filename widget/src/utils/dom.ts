/** Tiny DOM helpers. The widget renders inside a Shadow DOM (see ui/root.ts). */

/** Create an element with optional class and text. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text; // textContent, never innerHTML
  return node;
}

/** Derive a stable, human-readable identifier for a clicked element. */
export function describeElement(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest('[data-track], a, button, [role="button"]') ?? target;
  if (!(node instanceof Element)) return null;

  const explicit = node.getAttribute('data-track') || node.getAttribute('data-testid');
  if (explicit) return explicit.slice(0, 80);
  if (node.id) return `#${node.id}`.slice(0, 80);

  const label = (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' ');
  if (label) return `${node.tagName.toLowerCase()}:${label}`.slice(0, 80);
  return node.tagName.toLowerCase();
}
