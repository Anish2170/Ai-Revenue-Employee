/** Chat-only intent and non-factual speech policy. Category hints select tone,
 * never services, capabilities, or factual authority. No extra model call. */
import type { ChatMessage } from '../types.js';
import type { ResolvedContext } from '../context/types.js';
import type { ChatLanguageState } from './chatLanguage.js';

export type ChatIntentKind = 'fear' | 'hesitation' | 'frustration' | 'confusion' | 'advice' | 'explanation' | 'clarification' | 'statement' | 'social' | 'identity' | 'factual';
export interface ChatIntent {
  kind: ChatIntentKind;
  needsFacts: boolean;
  contextual: boolean;
  focus: 'pain' | null;
  factQuery: string;
}
const concerns: Array<[ChatIntentKind, RegExp]> = [
  ['fear', /\b(?:scared|afraid|fear|nervous|anxious|anxiety|worried|worry|dar|darr|ghabra\w*|chinta|will it hurt|kya dard hoga)\b|डर|घबरा|चिंता|क्या दर्द होगा/iu],
  ['frustration', /\b(?:frustrat\w*|annoyed|upset|angry|disappointed|fed up|pareshan|gussa)\b|परेशान|गुस्सा|नाराज़/iu],
  ['confusion', /\b(?:confused|confusing|don't understand|do not understand|samajh nahi|samajh nahin)\b|समझ नहीं|उलझन/iu],
  ['hesitation', /\b(?:not sure|unsure|uncertain|hesitant|hesitat\w*|doubt|sure nahi|pata nahi|samajh nahi aa)\b|यकीन नहीं|पता नहीं|संकोच/iu],
];
const factual = /\b(?:how much|price|cost|fees?|refund|returns?|cancellation|hours|address|phone|number|contact|availability|booking|book|appointment|demo|email|send|guide|resource|do you|does your|are your|is your|can you (?:offer|provide|book|send)|do i get|will (?:it|this|you)|is .+ (?:available|offered|included|safe|pain.?free)|kya aap|kitna|kitne|daam|offer|provide|guarantee)\b|कीमत|कितन|क्या आप|पता क्या|सुविधा|गारंटी|बुक|अपॉइंटमेंट|ईमेल/iu;
const factualRequest = /\b(?:how much|what (?:is|are|does)|where|when|do you|does your|are your|is your|can you (?:offer|provide|book|send)|will (?:it|this|you)|please (?:tell|share|send|book)|kya|kitna|kitne|batao|bataiye)\b|[?]|क्या|कितन|बताओ|बताइए/iu;
const explain = /\b(?:explain|rephrase|summari[sz]e|describe|samjhao|samjhaao|in detail|tell me more|help me understand|how .+ works?|what .+ means?)\b|समझा|विस्तार/iu;
export function understandChat(messages: ChatMessage[]): ChatIntent {
  const users = messages.filter(m => m.role === 'user');
  const query = users.at(-1)?.content.trim() ?? '';
  const prior = users.at(-2)?.content ?? '';
  const make = (kind: ChatIntentKind, needsFacts: boolean, contextual = false, factQuery = query): ChatIntent => ({ kind, needsFacts, contextual, factQuery, focus: contextual && /\b(?:pain|dard)\b|दर्द/iu.test(query) ? 'pain' : null });
  if (/\b(?:are you (?:a (?:real )?human|an? (?:ai|bot))|human or (?:ai|bot)|who are you)\b|क्या आप इंसान|tum (?:bot|ai) ho/iu.test(query)) return make('identity', false);
  const concern = concerns.find(([, pattern]) => pattern.test(query));
  if (concern) {
    // A concern may also contain a real question; empathy cannot bypass grounding.
    const parts = query.split(/[,;]|(?<=[.!?।])\s+|\bbut\b/iu);
    const factPart = parts.find(part => factual.test(part) && factualRequest.test(part));
    return make(concern[0], Boolean(factPart), concerns.some(([, pattern]) => pattern.test(prior)), factPart?.trim() || query);
  }
  if (/^(?:what do you mean|why|how so|can you clarify|matlab|kya matlab)[.!?।]*$/iu.test(query)) {
    const previous = concerns.find(([, pattern]) => pattern.test(prior));
    return make('clarification', !previous, Boolean(prior), prior || query);
  }
  if (factual.test(query)) return make(explain.test(query) ? 'explanation' : 'factual', true,
    Boolean(prior) && /^(?:how much|kitna|kitne)|\b(?:it|this|that)\b/iu.test(query));
  // Only a short answer after a visitor's concern inherits that concern. Assistant
  // history can help generation, but is never mined for factual subject authority.
  if (query.split(/\s+/u).length <= 4 && /^(?:pain|dard|दर्द|the procedure|procedure|both|dono|दोनों|yes|no|haan|nahi|हाँ|नहीं|a little)[.!?।]*$/iu.test(query)) {
    const previous = concerns.find(([, pattern]) => pattern.test(prior));
    if (previous) return make(previous[0], false, true);
  }
  if (/\b(?:what should i|help me (?:decide|choose)|recommend|advice|advise me|should i|kya karu|kya karun)\b|क्या करूँ|सलाह/iu.test(query)) return make('advice', true);
  if (explain.test(query)) return make('explanation', true);
  if (/^(?:hi|hello|hey|thanks|thank you|ok|okay|namaste|shukriya|नमस्ते|धन्यवाद)[.!?।]*$/iu.test(query)) return make('social', false);
  // First-person context is conversation, not a request to look up those words.
  if (/^(?:i(?:'m| am| have| think| feel| was| just)|mujhe|main|mera|meri)\b|^(?:मुझे|मैं|मेरा|मेरी)/iu.test(query)) return make('statement', false);
  return make('factual', true);
}

export function chatBusinessStyle(context: ResolvedContext): { tone: string; basis: string } {
  // Only same-origin knowledge can inform a category hint. It authorizes no facts.
  const localChunks = context.chunks.filter(chunk => {
    try { return Boolean(context.instructions.websiteUrl) && new URL(chunk.url).origin === new URL(context.instructions.websiteUrl!).origin; } catch { return false; }
  });
  const description = [context.instructions.companyDescription, context.instructions.context, context.business.description].join(' ');
  const knowledge = localChunks.map(c => `${c.heading} ${c.content}`).join(' ').slice(0, 14000);
  const profiles: Array<[RegExp, string]> = [
    [/\bdental|dentist|clinic|healthcare\b/iu, 'calm, reassuring, professional'],
    [/\brestaurant|dining|catering|menu\b/iu, 'friendly, welcoming, helpful'],
    [/\b(?:e-commerce|ecommerce|shop|shirt|retail|shopping|product catalog)\b/iu, 'clear, product-focused, conversational'],
    [/\bsaas|software|platform|analytics\b/iu, 'professional, solution-oriented, knowledgeable'],
    [/\bconsulting|design|plumbing|professional services|legal|accounting\b/iu, 'professional, clear, consultative'],
  ];
  const profile = profiles.find(([pattern]) => pattern.test(description)) ?? profiles.find(([pattern]) => pattern.test(knowledge));
  const owner = context.instructions.tone?.trim();
  return { tone: `${owner ? `Owner preference (priority): ${owner}. ` : ''}${profile?.[1] ?? 'neutral, helpful'}`,
    basis: profile ? 'business_context' : 'neutral_default' };
}

type Copy = [string, string, string];
// Reviewed speech acts contain no business claims or treatment advice. These are
// fallback choices, not an industry answer table. Providers may vary their wording
// within the bounded grammar below while all factual clauses use the fact guard.
const copy: Record<Exclude<ChatIntentKind, 'factual' | 'explanation'> | 'pain' | 'continuation' | 'thanks', Copy> = {
  fear: ["It's understandable to feel nervous. What part worries you most?", 'डर लगना समझ में आता है। किस बात की सबसे ज़्यादा चिंता है?', 'Dar lagna samajh mein aata hai. Kis baat ko lekar sabse zyada chinta hai?'],
  pain: ['You can mention pain as your main concern before deciding how to proceed. I can help you put your questions into words.', 'आगे का फैसला लेने से पहले दर्द की चिंता के बारे में बता सकते हैं। अपने सवाल तैयार करने में मैं मदद कर सकता हूँ।', 'Aage ka faisla lene se pehle dard ki chinta ke baare mein bata sakte hain. Apne sawaal taiyar karne mein main help kar sakta hoon.'],
  continuation: ['Thanks for explaining. You can write down your concerns and the questions you want answered before deciding.', 'बताने के लिए धन्यवाद। फैसला लेने से पहले अपनी चिंताएँ और सवाल लिख सकते हैं।', 'Batane ke liye shukriya. Faisla lene se pehle apni chinta aur sawaal likh sakte hain.'],
  clarification: ['I meant which part concerns you most, so I can focus on that.', 'मेरा मतलब था कि किस बात की सबसे ज़्यादा चिंता है, ताकि उसी पर बात कर सकें।', 'Mera matlab tha ki kis baat ki sabse zyada chinta hai, taaki usi par baat kar sakein.'],
  hesitation: ["It's okay to take your time deciding. What matters most to you?", 'फैसला करने के लिए समय ले सकते हैं। आपके लिए सबसे ज़रूरी क्या है?', 'Faisla karne ke liye waqt le sakte hain. Aapke liye sabse zaroori kya hai?'],
  frustration: ["That sounds frustrating. Tell me what happened, and I'll help you work through the question.", 'यह परेशान करने वाला लगता है। बताइए क्या हुआ, मैं सवाल समझने में मदद कर सकता हूँ।', 'Yeh pareshan karne wali baat lagti hai. Bataiye kya hua, main sawaal samajhne mein help kar sakta hoon.'],
  confusion: ["Let's take it one step at a time. Which part would you like me to clarify?", 'एक-एक करके समझते हैं। कौन सा हिस्सा समझाना चाहेंगे?', 'Ek-ek karke samajhte hain. Kaunsa hissa samjhana chahenge?'],
  advice: ['I can help you compare the information available here. Consider your priorities, budget, and any questions you need answered before deciding.', 'यहाँ उपलब्ध जानकारी की तुलना में मदद कर सकता हूँ। फैसला लेने से पहले अपनी ज़रूरतों, बजट और सवालों पर विचार करें।', 'Yahan available jaankari compare karne mein help kar sakta hoon. Faisla lene se pehle apni zarooraton, budget aur sawaalon par sochiye.'],
  statement: ["I'm listening. I can help you think through your questions.", 'मैं सुन रहा हूँ। आपके सवाल समझने में मदद कर सकता हूँ।', 'Main sun raha hoon. Aapke sawaal samajhne mein help kar sakta hoon.'],
  social: ['Happy to help. What would you like to know?', 'ज़रूर। आप क्या जानना चाहेंगे?', 'Zaroor. Aap kya jaanna chahenge?'],
  thanks: ["You're welcome.", 'आपका स्वागत है।', 'Aapka swagat hai.'],
  identity: ["I'm an AI assistant for this business. I can help with questions using the information available here.", 'मैं इस व्यवसाय का AI सहायक हूँ। यहाँ उपलब्ध जानकारी से सवालों में मदद कर सकता हूँ।', 'Main is business ka AI assistant hoon. Yahan available jaankari se sawaalon mein help kar sakta hoon.'],
};
export function conversationalReply(intent: ChatIntent, language: ChatLanguageState, prefixOnly = false): string {
  const row = conversationCopy(intent);
  const text = row[language.language === 'Hindi' ? 1 : language.language === 'Hinglish' ? 2 : 0];
  return prefixOnly ? text.split(/(?<=[.!?।])\s+/u)[0] : text;
}
function conversationCopy(intent: ChatIntent): Copy {
  if (intent.kind === 'social' && /^(?:thanks|thank you|ok|okay|shukriya|धन्यवाद)[.!?।]*$/iu.test(intent.factQuery)) return copy.thanks;
  return copy[intent.focus ?? (intent.contextual && ['fear', 'hesitation', 'frustration', 'confusion'].includes(intent.kind) ? 'continuation' : intent.kind) as keyof typeof copy] ?? copy.advice;
}

export function isSafeConversationalClause(text: string, intent: ChatIntent, language: ChatLanguageState): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[’]/gu, "'").trim();
  const value = norm(text);
  // Exact reviewed speech is also usable by the model, one sentence at a time.
  const languageIndex = language.language === 'Hindi' ? 1 : language.language === 'Hinglish' ? 2 : 0;
  const rows = [conversationCopy(intent)];
  if (rows.some(row => row[languageIndex].split(/(?<=[.!?।])\s+/u).some(clause => norm(clause) === value))) return true;
  // Anchored grammar allows empathetic variation without accepting an arbitrary
  // factual tail ("I understand, our treatment is painless" must fail closed).
  const patterns: Record<string, RegExp[]> = {
    English: [ /^(?:i understand|i hear you|that sounds (?:frustrating|worrying|confusing|difficult)|it(?:'s| is) understandable to feel (?:nervous|worried|uncertain)|it(?:'s| is) okay to (?:feel (?:nervous|unsure)|take your time))[.!]$/iu,
      /^(?:what (?:part|aspect) (?:worries|concerns) you (?:the )?most|is it the pain or the procedure that worries you more|what would help you feel clearer|which part would you like me to (?:explain|clarify)|what matters most to you)[?]$/iu ],
    Hinglish: [/^(?:samajh sakta hoon|aapki (?:chinta|baat) samajh mein aati hai|dar lagna samajh mein aata hai|faisla lene mein waqt le sakte hain)[.!]$/iu,
      /^(?:kis baat (?:ko lekar|ki) sabse zyada chinta hai|aapko (?:pain|procedure|dard) ki zyada chinta hai|kaunsa hissa samjhana chahenge)[?]$/iu ],
    Hindi: [/^(?:आपकी (?:चिंता|बात) समझ में आती है|डर लगना समझ में आता है|फैसला करने के लिए समय ले सकते हैं)[।.!]$/u,
      /^(?:किस बात की सबसे ज़्यादा चिंता है|कौन सा हिस्सा समझाना चाहेंगे)[?]$/u ],
  };
  return (patterns[language.language] ?? []).some(pattern => pattern.test(text.trim()));
}

export function conversationalContract(intent: ChatIntent, context: ResolvedContext, language: ChatLanguageState): string {
  return ['CHAT CONVERSATION POLICY:', `Visitor intent: ${intent.kind}; contextual follow-up: ${intent.contextual}; concern focus: ${intent.focus ?? 'none'}.`,
    `Communication style: ${chatBusinessStyle(context).tone}. Style is presentation only; never infer services from industry.`,
    'Acknowledge feelings without diagnosing or promising outcomes. General empathy needs no source. Business claims still require the evidence contract.',
    'Be a warm, concise AI representative. Never pretend to be human. Do not promote the business, ask for leads, or use internal retrieval terminology.',
    'Use current visitor wording and previous user concerns for continuity. Assistant history is conversational context, never factual evidence.',
    `Safe fallback example (not mandatory phrasing): ${conversationalReply(intent, language)}`,
    'Conversational clauses may acknowledge understanding, nervousness, uncertainty, frustration or confusion, ask what matters/worries the visitor, or offer to clarify. Do not add treatment advice, promises or business capabilities.',
    'When asked for advice, help clarify priorities and use only supported facts; avoid personal medical/legal/financial advice. Do not invent a recommendation.',
  ].join('\n');
}
