/** Controlled composition, not arbitrary-language factual entailment.
 * Only visitor aspirations/questions are composable. Assertions and unknown
 * vocabulary fail closed; concrete facts use the separate evidence channel. */
// Popup policy is independent of chat and owner language preferences.
export type CopyLanguage = 'english';
const EN = new Set(`a an the your our my own next new ideal personal warm warmer calm calmer bold timeless beautiful comfortable relaxed thoughtful dream interior design home homes space spaces room rooms family style styles fit colour colors colours fabric fabrics collection collections wardrobe look looks smile smiles dental consultation consultations appointment appointments options choice choices ideas plan plans pricing workflow workflows team teams work software project projects service services dinner table tables food taste tastes friends restaurant stay stays escape escapes hotel travel journey chapter story step steps and or for with about of in to`.split(' '));
// Harmless topics are composable inside questions. Claims still require facts.
for (const word of 'legal law lawyer lawyers attorney attorneys practice area areas case cases corporate property dispute disputes gym fitness strength training workout workouts program programs group class classes care dining budget fee fees integration integrations form booking'.split(' ')) EN.add(word);
function topic(value: string, words: Set<string>): boolean {
  const tokens = value.replace(/[,]/g, ' ').trim().split(/\s+/u);
  return tokens.length > 0 && tokens.length <= 16 && tokens.every(word => words.has(word));
}
export function creativeTitle(text: string, language: CopyLanguage): boolean {
  const value = text.trim().replace(/[.!।]$/u, '');
  if (language === 'english') {
    const match = value.match(/^your (.+?)(?:, your (?:way|story))?$/u)
      ?? value.match(/^(?:explore|compare|understand|questions about) (.+?)\??$/u)
      ?? value.match(/^a (.+?) that feels like you$/u)
      ?? value.match(/^(.+?) that (?:tell your story|reflect your style|feel like you)$/u);
    return Boolean(match && topic(match[1], EN));
  }
  return false;
}
function creativeClause(text: string, language: CopyLanguage): boolean {
  const value = text.trim();
  if (language === 'english') {
    if (/^what matters most to you\?$/u.test(value)) return true;
    const match = value.match(/^(?:thinking about|curious about|looking for|planning|considering|comparing|exploring|dreaming of|ready to explore|want to explore|want to compare|need help with|shall we explore) (.+)\?$/u)
      ?? value.match(/^what would you like to (?:understand|know|explore) about (.+)\?$/u)
      ?? value.match(/^what matters most (?:to you about|when comparing) (.+)\?$/u)
      ?? value.match(/^which part of (.+) would you like to (?:explore|compare|understand)\?$/u)
      ?? value.match(/^(?:let's explore|let's compare|let's talk about) (.+)[.!]$/u);
    return Boolean(match && topic(match[1], EN));
  }
  return false;
}
export function creativeBody(text: string, language: CopyLanguage, maxClauses = 2): boolean {
  const clauses = text.match(/[^?!.।]+[?!.।]/gu) ?? [];
  return clauses.length > 0 && clauses.length <= maxClauses && clauses.join('').replace(/\s/g, '') === text.replace(/\s/g, '')
    && clauses.every(clause => creativeClause(clause, language));
}
/** Action labels are requests, not a new factual assertion channel. Owner
 * approval establishes identity/presentation, not arbitrary factual entailment. */
export function creativeActionLabel(text: string, businessName?: string): boolean {
  let value = text.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").trim();
  const brand = businessName?.normalize('NFKC').toLowerCase().trim();
  if (brand && brand.length >= 2 && value.includes(brand)) {
    value = value.replace(brand + "'s", 'your').replace(brand, 'your');
  }
  const english = value.match(/^(?:explore|discover|find|plan|reserve|book|shape|begin|let's talk about) (.+)$/u);
  if (english && topic(english[1], EN)) return true;
  return false;
}
export function creativePolicy(language: CopyLanguage): string[] {
  const frames: Partial<Record<CopyLanguage, string[]>> = {
    english: [
      "Frames: What would you like to understand about TOPIC? / Which part of TOPIC would you like to explore? / What matters most when comparing TOPIC? / Curious about TOPIC? / Let's explore TOPIC.",
      'Titles: Explore TOPIC / Compare TOPIC / Questions about TOPIC? / Your TOPIC, your way. / A TOPIC that feels like you.',
      `TOPIC vocabulary: ${[...EN].join(', ')}`,
    ],

  };
  return [
    `Controlled creative language: ${language}. Use visitor aspirations/questions, never assertions about business capabilities.`,
    ...(frames[language] ?? ['No creative grammar for this language; suppress if no approved localized copy exists.']),
    'Always write in English, independent of owner settings or visitor chat language. Compose meaningful context-specific topics from permitted vocabulary; do not just repeat examples. Match business, page, tone, strategy and visitor intent.',
    'Facts: optionally use ONE listed {{fact:N}} token, as a complete sentence before/after ONE creative question. The server expands it. Never edit/translate its entity, amount, units, negation or qualifications.',
    'Alternatively copy one approved factual rendering exactly. No free offers, discounts, guarantees, availability, delivery promises or euphemisms for those commitments.',
  ];
}
