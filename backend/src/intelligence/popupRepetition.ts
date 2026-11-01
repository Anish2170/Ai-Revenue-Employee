/** Bounded lexical duplicate protection. Strategy/ID changes do not make the
 * same message new. No model calls or persisted customer copy are required. */
export interface PopupContent { title?: string; body: string; actionKey: string }
export interface PopupFingerprint { exact: string; tokens: string[]; numbers: string; actionKey: string }
const filler = new Set('a an the our your you to and or of for in on at is are be with this that before next step'.split(' '));
export function popupFingerprint(copy: PopupContent): PopupFingerprint {
  const exact = `${copy.title ?? ''} ${copy.body}`.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}$₹€£¥]+/gu, ' ').trim();
  return { exact, actionKey: copy.actionKey, tokens: [...new Set(exact.split(' ').filter(t => !filler.has(t)))], numbers: (exact.match(/\d+/gu) ?? []).sort().join('|') };
}
export function repeatsPopup(a: PopupFingerprint, b: PopupFingerprint): boolean {
  if (a.actionKey !== b.actionKey || a.numbers !== b.numbers) return false;
  if (a.exact === b.exact) return true;
  const shared = a.tokens.filter(token => b.tokens.includes(token)).length;
  return Math.min(a.tokens.length, b.tokens.length) >= 5 && shared / new Set([...a.tokens, ...b.tokens]).size >= .8;
}
