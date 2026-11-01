/** Shared relevance hints, never factual authorization. No business entities or
 * values live here. Keep channel requests separate from service availability. */
export function normalizeFactQuery(text: string): string {
  return text.normalize('NFKC').toLowerCase()
    .replace(/\b(?:avilabe|availabe|availble|avalable)\b/gu, 'available')
    .replace(/\bemergncy\b/gu, 'emergency')
    .replace(/आपातकालीन|आपातकाल/gu, 'emergency')
    .replace(/उपलब्ध/gu, 'available').replace(/सेवाएं|सेवाएँ|सेवा/gu, 'service')
    .replace(/नंबर|नम्बर/gu, 'number').replace(/संपर्क|सम्पर्क/gu, 'contact')
    .replace(/\bhot[- ]line\b/gu, 'hotline');
}
const fillers = new Set('what which are is do does have you your we our me i how can could would please tell give the a an to for of at in details information contact contacts phone telephone number num nbr no email address hotline helpline line service services available availability offer offered provide provided kya hai hain ka ki ke aap aapka aapki mujhe batao bataye क्या है हैं आपका अपनी की का के बताओ बताइए'.split(' '));
export function factTopicTerms(text: string): string[] {
  return (normalizeFactQuery(text).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .map(word => /^(?:emergency|urgent|urgently)$/u.test(word) ? 'urgent' : word)
    .filter(word => !fillers.has(word));
}
export function contactRequest(query: string): { channel: 'phone' | 'email' | 'any'; topics: string[] } | null {
  const text = normalizeFactQuery(query);
  const phone = /\b(?:phone|telephone|tel|number|num|nbr|hotline|helpline)\b/u.test(text)
    || /\b[\p{L}]+\s+no[.?!]*$/u.test(text);
  const email = /\bemail\b/u.test(text);
  const contact = /\bcontact\b/u.test(text);
  // An outbound email/callback request is a workflow, not a source contact lookup.
  if (/\b(?:email|contact|call) me\b|\bsend\b.*\bemail\b/u.test(text)) return null;
  if (!phone && !email && !contact) return null;
  return { channel: phone ? 'phone' : email ? 'email' : 'any', topics: factTopicTerms(text) };
}
export function availabilityRequest(query: string): boolean {
  const text = normalizeFactQuery(query);
  return /\bdo you (?:have|offer|provide)\b|\bavailable\b/u.test(text) && !contactRequest(query);
}
