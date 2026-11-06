import type { BusinessInstructions } from '../context/types.js';
import type { StrategyKnowledgeResult } from './knowledgeRetrieval.js';
import type { ConversationStrategyKind } from './conversationStrategy.js';
import { repeatsPopupBody } from './popupRepetition.js';

export interface RecentPopupCopy { title?: string; body: string }
export interface PopupPersonalizationContext {
  pagePath?: string;
  strategy?: ConversationStrategyKind;
  formAssistance?: boolean;
  recentInterests?: readonly string[];
  previousPopups?: readonly RecentPopupCopy[];
}
export interface PopupCopyBrief {
  topic: string;
  page: string;
  purpose: string;
  interests: string[];
  titles: string[];
  invitations: string[];
  topicPattern?: RegExp;
}

// Curated topics describe questions, never capabilities, prices or promises.
// Source text can select a topic; it cannot supply executable authoring rules.
const TOPICS = [
  { topic: 'family law', match: /\bfamily law\b/i, related: /\b(family|legal|law|consultation)\b/i },
  { topic: 'property law', match: /\b(property law|property disputes?)\b/i, related: /\b(property|legal|law|consultation)\b/i },
  { topic: 'corporate law', match: /\b(corporate law|business law)\b/i, related: /\b(corporate|business|legal|law|consultation)\b/i },
  { topic: 'legal services', match: /\b(law|legal|lawyer|attorney|litigation|practice areas?)\b/i, related: /\b(legal|law|lawyer|attorney|practice|consultation)\b/i },
  { topic: 'strength training', match: /\bstrength training\b/i, related: /\b(strength|training|fitness|workout|program)\b/i },
  { topic: 'personal training', match: /\bpersonal training\b/i, related: /\b(personal|training|fitness|workout|program)\b/i },
  { topic: 'fitness programs', match: /\b(gym|fitness|workout|strength training|personal training|group classes)\b/i, related: /\b(fitness|gym|training|workout|program|classes)\b/i },
  { topic: 'dental care', match: /\b(dental|dentist|smile|teeth)\b/i, related: /\b(dental|smile|teeth|consultation)\b/i },
  { topic: 'hotel options', match: /\b(hotel|resort|guest rooms?)\b/i, related: /\b(stay|room|hotel|travel|escape)\b/i },
  { topic: 'dining options', match: /\b(restaurant|dining|dinner)\b/i, related: /\b(dining|dinner|table|restaurant|food)\b/i },
  { topic: 'your personal style', match: /\b(clothing|fashion|wardrobe|fabric)\b/i, related: /\b(style|collection|wardrobe|fabric|look)\b/i },
  { topic: 'your space', match: /\b(interior|interiors|decor|furniture)\b/i, related: /\b(space|design|home|room|interior)\b/i },
  { topic: 'your workflow', match: /\b(software|saas|workflow|integrations?)\b/i, related: /\b(workflow|software|team|plan|integration)\b/i },
] as const;

function pathname(value?: string): string {
  try { return decodeURIComponent(new URL(value ?? '/', 'https://page.invalid').pathname).replace(/[-_/]+/g, ' ').trim().slice(0, 160); }
  catch { return ''; }
}
function samePage(left?: string, right?: string): boolean {
  try { return new URL(left ?? '/', 'https://page.invalid').pathname.replace(/\/$/, '') === new URL(right ?? '/', 'https://page.invalid').pathname.replace(/\/$/, ''); }
  catch { return false; }
}

export function buildPopupCopyBrief(knowledge: StrategyKnowledgeResult, instructions: BusinessInstructions, context: PopupPersonalizationContext): PopupCopyBrief {
  const path = pathname(context.pagePath);
  const local = knowledge.chunks.filter(chunk => context.pagePath && samePage(context.pagePath, chunk.page));
  const localText = local.map(chunk => `${chunk.heading} ${chunk.content.slice(0, 1200)}`).join(' ').slice(0, 3600);
  const businessText = `${instructions.businessName} ${knowledge.chunks.map(chunk => chunk.heading).join(' ')}`.slice(0, 1200);
  // Page-specific topics win over other retrieved pages and broad business names.
  const broadTopics = TOPICS.filter(item => !['family law', 'property law', 'corporate law', 'strength training', 'personal training'].includes(item.topic));
  const selected = TOPICS.find(item => item.match.test(path))
    ?? broadTopics.find(item => item.match.test(localText))
    ?? broadTopics.find(item => item.match.test(businessText));
  const topic = selected?.topic ?? (/\b(pricing|plans|fees)\b/i.test(path) ? 'pricing options' : /\b(programs?|services|practice areas?)\b/i.test(path) ? 'service options' : 'your next step');
  const page = /\b(pricing|plans|fees)\b/i.test(path) ? 'pricing'
    : /\b(appointment|consultation|booking|contact)\b/i.test(path) ? 'consultation or contact'
    : /\b(programs?|services|practice areas?)\b/i.test(path) ? 'services or programs'
    : /\b(about|testimonials?|case studies|faq)\b/i.test(path) ? 'background and questions' : 'exploration';
  const kind = context.formAssistance ? 'Support' : context.strategy ?? 'Educate';
  const scope = topic.replace(/^your /, '');
  const choices: Record<ConversationStrategyKind, { purpose: string; titles: string[]; invitations: string[] }> = {
    Educate: { purpose: 'Help the visitor understand the relevant options', titles: [`Explore ${scope}`, `Find clarity on ${scope}`, `Your ${scope}, your way`], invitations: [`What would you like to understand about ${topic}?`, `Which part of ${topic} would you like to explore?`, `Curious about ${topic}? What matters most to you?`] },
    Compare: { purpose: 'Help compare relevant options without inventing differences', titles: [`Compare ${scope}`, 'A clearer choice', `Your ${scope}, your choice`], invitations: [`What matters most when comparing ${topic}?`, `Want to compare your options for ${scope}?`, `Which part of ${topic} would you like to compare?`] },
    ReducePriceAnxiety: { purpose: 'Clarify pricing questions, never imply an offer or affordability', titles: [`Questions about ${scope} pricing?`, 'Before choosing your next step', 'Make sense of the pricing'], invitations: [`What would you like to understand about pricing for ${scope}?`, `Want to talk through pricing questions about ${topic}?`, `Comparing pricing for ${scope}? What matters most to you?`] },
    BuildTrust: { purpose: 'Invite questions before a decision without inventing credentials or guarantees', titles: [`Get clarity on ${scope}`, 'Questions before your next step?', `Understand ${scope}`], invitations: [`What would you like to know before choosing ${topic}?`, `Which questions about ${topic} would you like to explore?`, `Want to talk through your questions about ${topic}?`] },
    BookAppointment: { purpose: 'Help with the next appointment step using an approved action', titles: [`Your next step for ${scope}`, 'Ready to plan your next step?', `Talk through ${scope}`], invitations: [`Want to discuss ${topic} before planning an appointment?`, `Which questions about ${topic} would you like to discuss?`, `Ready to explore the next step for ${scope}?`] },
    BookDemo: { purpose: 'Offer the approved demo step without inventing capabilities', titles: [`Explore ${scope} in a demo`, 'Your questions, a clearer next step', 'Plan your demo questions'], invitations: [`What would you like to explore about ${topic} in a demo?`, `Want to discuss ${topic} before arranging a demo?`, `Which questions about ${topic} would you bring to a demo?`] },
    GenerateLead: { purpose: 'Offer a relevant conversation using an approved contact action', titles: [`Talk through ${scope}`, 'A useful next conversation', `Your next step for ${scope}`], invitations: [`Want to discuss the next step for ${scope}?`, `Which questions about ${topic} would you like to talk through?`, `What matters most to you about ${topic}?`] },
    Support: { purpose: context.formAssistance ? 'Help with the paused form, never infer its private contents' : 'Help answer a relevant question', titles: [context.formAssistance ? 'A hand with this form?' : `Questions about ${scope}?`, 'Take the next step with clarity', `Talk through ${scope}`], invitations: context.formAssistance ? ['Would you like help with a step in this form?', 'Which part of the form would you like help with?', 'Want to ask a question before continuing with the form?'] : [`Which questions about ${topic} would you like help with?`, `Want to talk through a question about ${topic}?`, `What would you like to understand about ${topic}?`] },
  };
  const choice = choices[kind];
  if (kind === 'ReducePriceAnxiety' && topic === 'pricing options') {
    choice.titles = ['Make sense of the pricing', 'Questions before you choose?', 'Compare the pricing details'];
    choice.invitations = ['What would you like to understand about these pricing options?', 'Which pricing details would you like to talk through?', 'Comparing pricing options? What matters most to you?'];
  }
  const previous = (context.previousPopups ?? []).slice(-2);
  return { topic, page, purpose: choice.purpose, interests: [...new Set((context.recentInterests ?? []).filter(value => ['pricing', 'services', 'trust', 'booking', 'comparison'].includes(value)))].slice(0, 4), titles: choice.titles, invitations: choice.invitations.filter(text => !previous.some(copy => repeatsPopupBody(copy.body, text))), topicPattern: selected?.related };
}
