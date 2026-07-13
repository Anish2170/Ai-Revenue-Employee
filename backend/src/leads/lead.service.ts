import { prisma } from '../db/prisma.js';
import type { ChatMessage } from '../validation/requestSchemas.js';
import type { VisitorBehaviour } from '../types.js';

type LeadDelegate = {
  upsert: (args: Record<string, unknown>) => Promise<unknown>;
  findMany: (args: Record<string, unknown>) => Promise<unknown[]>;
};

const leadModel = (prisma as unknown as { lead: LeadDelegate }).lead;

type LeadTenant = { organizationId: string; websiteId: string };

type LeadCaptureInput = {
  tenant: LeadTenant;
  conversationId: string;
  visitorId?: string;
  sessionId?: string;
  messages: ChatMessage[];
  assistantReply: string;
  behaviour?: VisitorBehaviour;
};

type LeadContact = { name?: string; email?: string; phone?: string };

const EMAIL_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const FAKE_NAMES = new Set(['test', 'testing', 'abc', 'qwerty', 'asdf', 'anonymous', 'user']);
type IntentSignal = {
  intent: string;
  reason: string;
  re: RegExp;
  points: number;
};

type IntentAssessment = {
  intent: string;
  score: number;
  label: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  shouldCapture: boolean;
};

const CONTEXT_SIGNALS: IntentSignal[] = [
  { intent: 'Pricing', reason: 'Asked about pricing, costs, plans, or budget', re: /\b(price|pricing|cost|costs|plan|plans|fee|quote|estimate|package|subscription|budget)\b/i, points: 38 },
  { intent: 'Enterprise', reason: 'Discussed company, enterprise, procurement, security, or compliance needs', re: /\b(enterprise|company|companies|organization|team|teams|department|procurement|security|sla|sso|compliance)\b/i, points: 44 },
  { intent: 'Demo', reason: 'Requested a demo, call, meeting, consultation, or walkthrough', re: /\b(demo|walkthrough|show me|trial|consultation|consult|call|meeting|appointment|book|schedule)\b/i, points: 58 },
  { intent: 'Implementation', reason: 'Needs implementation, setup, migration, integration, rollout, or onboarding help', re: /\b(implementation|implement|setup|onboarding|migration|migrate|integrat|api|custom|deploy|rollout)\b/i, points: 72 },
  { intent: 'Comparison', reason: 'Comparing vendors, firms, platforms, providers, or options', re: /\b(compare|comparing|comparison|versus|vs\.?|alternative|alternatives|vendor|vendors|firm|firms|platform|platforms|provider|providers|evaluating|evaluation|shortlist|best fit|which option|recommend)\b/i, points: 48 },
  { intent: 'Purchase Timeline', reason: 'Has a near-term buying or hiring timeline', re: /\b(planning|plan|looking|ready|intend|need|want|purchase|buy|hire|decide|decision|go live|start|switch|engage)\b.{0,60}\b(today|this week|next week|this month|next month|quarter|q[1-4]|soon|by \w+)\b|\b(next month|this month|this quarter|next quarter)\b/i, points: 74 },
  { intent: 'Company Scale', reason: 'Shared meaningful organization size or scale', re: /\b\d{2,6}\s*(employees|users|seats|locations|branches|agents|staff|people|lawyers|attorneys)\b|\b(team of|company of)\s*\d{2,6}\b/i, points: 72 },
  { intent: 'Business Problem', reason: 'Described an active business need or problem', re: /\b(we need|we are looking for|we're looking for|our team needs|struggling with|problem|challenge|replace|switch from|current system|currently use|need help with)\b/i, points: 50 },
  { intent: 'Provider Switch', reason: 'Moving from or replacing another provider', re: /\b(moving from|switching from|replace|replacing|leaving|migrating from|current provider|another provider|existing vendor)\b/i, points: 76 },
  { intent: 'Proposal Request', reason: 'Asked for a proposal, quote, engagement details, or service package', re: /\b(proposal|rfp|quote|engagement letter|service package|scope of work|sow|retainer)\b/i, points: 76 },
  { intent: 'Ongoing Support', reason: 'Needs ongoing legal or business support', re: /\b(ongoing legal support|ongoing support|legal support|outside counsel|general counsel|retainer|monthly support|long-term support)\b/i, points: 74 },
  { intent: 'High-value Feature', reason: 'Asked about a high-value feature, workflow, or operational requirement', re: /\b(automation|workflow|reporting|analytics|crm|integration|support|permissions|roles|dashboard|multi-location|white label)\b/i, points: 28 },
];
const LOW_INTENT_SIGNALS: IntentSignal[] = [
  { intent: 'Low Intent', reason: 'Visitor said they are just curious', re: /\b(just curious|only curious|just browsing|only browsing|looking around|checking it out|researching generally)\b/i, points: -35 },
  { intent: 'Low Intent', reason: 'Visitor declined follow-up', re: /\b(no thanks|no thank you|not now|don't email|do not email|no need|i'm good|im good)\b/i, points: -45 },
  { intent: 'Low Intent', reason: 'Visitor is not ready yet', re: /\b(not ready|maybe later|someday|in the future|no budget|student|personal project)\b/i, points: -25 },
];

// Future learning hook: successful-lead patterns can be added here without changing storage or routes.
const SUCCESS_PATTERN_WEIGHTS: IntentSignal[] = [];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function latestUserMessage(messages: ChatMessage[]): string {
  return [...messages].reverse().find((message) => message.role === 'user')?.content ?? '';
}

function userTranscript(messages: ChatMessage[]): string {
  return messages.filter((message) => message.role === 'user').map((message) => message.content).join('\n');
}

function validateEmail(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().replace(/[),.;:!?]+$/g, '').toLowerCase();
  return EMAIL_RE.test(cleaned) ? cleaned : undefined;
}

function normalizePhone(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/[),.;:!?]+$/g, '');
  if (/[A-Za-z]/.test(trimmed)) return undefined;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  if (/^(\d)\1+$/.test(digits)) return undefined;
  const startsWithPlus = trimmed.trim().startsWith('+');
  return startsWithPlus ? `+${digits}` : digits;
}

function validateName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = normalizeText(raw).replace(/[^A-Za-z .'-]/g, '').trim();
  if (cleaned.length < 2 || cleaned.length > 80) return undefined;
  if (FAKE_NAMES.has(cleaned.toLowerCase())) return undefined;
  return cleaned;
}

function extractContact(messages: ChatMessage[]): LeadContact {
  const text = userTranscript(messages);
  const email = validateEmail(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]);
  const phoneCandidates = text.match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,5}\d{2,4}/g) ?? [];
  const phone = phoneCandidates.map(normalizePhone).find(Boolean);
  const name = validateName(
    text.match(/\b(?:my name is|i am|i'm|this is)\s+([A-Za-z][A-Za-z .'-]{1,79})/i)?.[1]
    ?? text.match(/\bname[:\s]+([A-Za-z][A-Za-z .'-]{1,79})/i)?.[1],
  );
  return { name, email, phone };
}

function invalidContactAttempts(messages: ChatMessage[]): number {
  let attempts = 0;
  for (const message of messages.filter((item) => item.role === 'user')) {
    const content = message.content.trim();
    const hasAt = content.includes('@');
    const hasPhoneLike = /\d/.test(content) && content.replace(/\D/g, '').length >= 3;
    const hasNameLike = /\b(name|my name is|i am|i'm)\b/i.test(content);
    if (hasAt && !validateEmail(content.match(/\S+@\S+/)?.[0])) attempts += 1;
    if (hasPhoneLike && !normalizePhone(content.match(/[+\d][\d\s().-]+/)?.[0])) attempts += 1;
    if (hasNameLike && !validateName(content.replace(/.*\b(?:name is|name|i am|i'm)\b[:\s]*/i, ''))) attempts += 1;
  }
  return attempts;
}

function pagesVisited(behaviour?: VisitorBehaviour): string[] {
  const pages = new Set<string>();
  if (behaviour?.page) pages.add(behaviour.page);
  for (const clicked of behaviour?.clickedElements ?? []) {
    const url = clicked.match(/https?:\/\/\S+|\/[^\s"']+/)?.[0];
    if (url) pages.add(url);
  }
  return [...pages].slice(0, 20);
}

function addSignal(matches: IntentSignal[], text: string, reasons: string[]): number {
  let score = 0;
  for (const signal of matches) {
    if (!signal.re.test(text)) continue;
    score += signal.points;
    reasons.push(signal.reason);
  }
  return score;
}

function strongestIntent(text: string): string {
  const matched = [...CONTEXT_SIGNALS, ...SUCCESS_PATTERN_WEIGHTS]
    .filter((signal) => signal.intent !== 'Low Intent' && signal.re.test(text))
    .sort((a, b) => b.points - a.points)[0];
  return matched?.intent ?? 'General Interest';
}

function contextualBoost(text: string, reasons: string[]): number {
  let score = 0;

  if (/\b(planning|plan|ready|intend|need|want|looking)\b.{0,50}\b(hire|purchase|buy|engage|switch|start)\b.{0,60}\b(next month|this month|this quarter|next quarter|soon)\b/i.test(text)) {
    score += 18;
    reasons.push('Planning a near-term purchase or hiring decision');
  }

  if (/\b(comparing|evaluating|shortlist|choosing between)\b.{0,60}\b(vendors|firms|platforms|providers|options)\b/i.test(text)) {
    score += 8;
    reasons.push('Actively evaluating multiple providers');
  }

  if (/\b\d{2,6}\s*(employees|users|seats|locations|branches|staff|people)\b/i.test(text) && /\b(need|support|implementation|platform|provider|firm|legal)\b/i.test(text)) {
    score += 12;
    reasons.push('Organization size is tied to an active need');
  }

  if (/\b(we|our company|our team)\b/i.test(text) && /\b(need|planning|comparing|evaluating|hire|purchase|support|implementation)\b/i.test(text)) {
    score += 8;
    reasons.push('Visitor is speaking for a business need, not casual browsing');
  }

  return score;
}

function inferIntent(messages: ChatMessage[], behaviour?: VisitorBehaviour): IntentAssessment {
  const transcript = userTranscript(messages);
  const text = `${transcript}\n${behaviour?.page ?? ''}\n${behaviour?.pageTitle ?? ''}`;
  const reasons: string[] = [];
  let score = 0;

  score += addSignal(CONTEXT_SIGNALS, text, reasons);
  score += contextualBoost(text, reasons);
  score += addSignal(SUCCESS_PATTERN_WEIGHTS, text, reasons);
  score += addSignal(LOW_INTENT_SIGNALS, text, reasons);

  const userQuestionCount = messages.filter((message) => message.role === 'user').length;
  if (userQuestionCount >= 3 && score > 0) {
    score += 12;
    reasons.push('Asked multiple follow-up questions');
  }

  if ((behaviour?.timeOnPage ?? 0) >= 120) {
    score += 8;
    reasons.push('Spent meaningful time on the page');
  }

  if (/pricing|plans|booking|demo|contact|quote|proposal/i.test(`${behaviour?.page ?? ''} ${behaviour?.pageTitle ?? ''}`)) {
    score += 12;
    reasons.push('Visited a high-intent page');
  }

  const hasStrongRejection = LOW_INTENT_SIGNALS.some((signal) => signal.points <= -40 && signal.re.test(text));
  const boundedScore = Math.max(0, Math.min(100, score));
  const label = scoreLabel(boundedScore);

  return {
    intent: strongestIntent(text),
    score: boundedScore,
    label,
    reasons: [...new Set(reasons)],
    shouldCapture: !hasStrongRejection && label !== 'LOW',
  };
}
function formatLeadReasons(reasons: string[]): string {
  if (reasons.length === 0) return 'Visitor shared validated contact details after a contextually qualified conversation.';
  return reasons.map((reason) => `- ${reason}`).join('\n');
}
function scoreLabel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

function suggestedNextAction(intent: string, hasPhone: boolean): string {
  if (/demo|consultation/i.test(intent)) return hasPhone ? 'Call to schedule the consultation.' : 'Email available consultation times.';
  if (/enterprise|company scale/i.test(intent)) return 'Send an implementation guide and ask about team size, timeline, and rollout needs.';
  if (/pricing/i.test(intent)) return 'Send a pricing comparison with the most relevant plan recommendation.';
  if (/comparison/i.test(intent)) return 'Send a vendor comparison summary tailored to the visitor\'s priorities.';
  if (/purchase timeline/i.test(intent)) return 'Follow up with decision support material and next-step options for the timeline.';
  if (/implementation/i.test(intent)) return 'Send an implementation checklist and offer a setup call.';
  return 'Follow up with the promised helpful resource.';
}

export async function captureLeadFromConversation(input: LeadCaptureInput): Promise<void> {
  const contact = extractContact(input.messages);
  const intent = inferIntent(input.messages, input.behaviour);
  const assistantOfferedValue = /send|email|call|book|schedule|quote|proposal|comparison|guide|checklist|summary|times/i.test(input.assistantReply);
  const invalidAttempts = invalidContactAttempts(input.messages);

  if (!contact.email && !contact.phone) return;
  if (invalidAttempts >= 3) return;
  if (!intent.shouldCapture && !assistantOfferedValue) return;

  let score = intent.score + 25;
  if (contact.email) score += 12;
  if (contact.phone) score += 16;
  score = Math.max(10, Math.min(100, score));

  const lastQuestion = normalizeText(latestUserMessage(input.messages)).slice(0, 500) || null;
  const pages = pagesVisited(input.behaviour);
  const reason = formatLeadReasons([...new Set([...intent.reasons, contact.email ? 'Shared valid email' : '', contact.phone ? 'Shared valid phone' : ''].filter(Boolean))]);

  await leadModel.upsert({
    where: contact.email
      ? { conversationId_email: { conversationId: input.conversationId, email: contact.email } }
      : { conversationId_phone: { conversationId: input.conversationId, phone: contact.phone! } },
    create: {
      organizationId: input.tenant.organizationId,
      websiteId: input.tenant.websiteId,
      conversationId: input.conversationId,
      visitorId: input.visitorId,
      sessionId: input.sessionId,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      interest: intent.intent,
      intent: intent.intent,
      scorePercent: score,
      scoreLabel: scoreLabel(score),
      reason,
      lastQuestion,
      pagesVisited: pages as any,
      suggestedNextAction: suggestedNextAction(intent.intent, Boolean(contact.phone)),
    },
    update: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      interest: intent.intent,
      intent: intent.intent,
      scorePercent: score,
      scoreLabel: scoreLabel(score),
      reason,
      lastQuestion,
      pagesVisited: pages as any,
      suggestedNextAction: suggestedNextAction(intent.intent, Boolean(contact.phone)),
      capturedAt: new Date(),
    },
  });
}

export async function listLeads(organizationId: string, websiteId?: string) {
  return leadModel.findMany({
    where: { organizationId, ...(websiteId ? { websiteId } : {}) },
    orderBy: { capturedAt: 'desc' },
    take: 300,
    include: {
      website: { select: { id: true, name: true, url: true } },
      conversation: { select: { id: true, title: true } },
    },
  });
}