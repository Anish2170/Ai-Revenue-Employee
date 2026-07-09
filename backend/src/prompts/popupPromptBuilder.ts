/**
 * Popup prompt builder (Sprint 4.2 component 3).
 *
 * Builds a structured prompt for language generation only. The prompt receives
 * conversation strategy, minimal knowledge, and safe summaries from Sprint 4.1;
 * it never receives raw semantic events and never asks the model to decide
 * whether to interrupt.
 */
import type { BusinessInstructions } from '../context/types.js';
import type { ConversationStrategy, ConversationStrategyKind } from '../intelligence/conversationStrategy.js';
import type { StrategyKnowledgeChunk, StrategyKnowledgeResult } from '../intelligence/knowledgeRetrieval.js';
import {
  MAX_POPUP_BODY_LENGTH,
  MAX_POPUP_CTA_LENGTH,
  MAX_POPUP_TITLE_LENGTH,
  popupJsonSchema,
  type PopupType,
} from '../validation/popupSchema.js';

export interface PopupPromptInput {
  business: {
    name: string;
    objectiveKey: string;
  };
  instructions: BusinessInstructions;
  strategy: ConversationStrategy;
  knowledge: StrategyKnowledgeResult;
}

export interface PromptSection {
  title: string;
  lines: string[];
}

export interface BuiltPopupPrompt {
  version: 'popup-v1';
  system: string;
  user: string;
  schema: typeof popupJsonSchema;
  sections: PromptSection[];
}

export const popupPromptBuilder = {
  version: 'popup-v1' as const,

  build(input: PopupPromptInput): BuiltPopupPrompt {
    const sections = buildSections(input);
    const system = renderSections([
      {
        title: 'Role',
        lines: [
          `You are the AI sales employee for ${input.business.name}.`,
          'The deterministic Sales Brain has already decided to speak.',
          'Your only job is to generate concise popup language that follows the approved strategy.',
        ],
      },
      {
        title: 'Hard Rules',
        lines: [
          'Do not decide whether to interrupt. That decision has already been made.',
          'Do not mention internal labels, confidence scores, behaviour states, or strategy names to the visitor.',
          'Use only the provided knowledge. Do not invent pricing, guarantees, features, case studies, or policies.',
          'If knowledge is missing or thin, write a modest offer to help instead of making a factual claim.',
          'Return only JSON matching the schema. No markdown, no extra prose.',
        ],
      },
    ]);
    const user = renderSections(sections);

    return { version: this.version, system, user, schema: popupJsonSchema, sections };
  },
};

function buildSections(input: PopupPromptInput): PromptSection[] {
  const { business, instructions, strategy, knowledge } = input;
  const visitor = strategy.visitor;

  return [
    {
      title: 'Business',
      lines: [
        `Name: ${business.name}`,
        `Objective: ${business.objectiveKey}`,
        `Owner tone: ${instructions.tone}`,
        `Language: ${instructions.language}`,
        `Policy - always book demo: ${instructions.alwaysBookDemo}`,
        `Policy - avoid discounts: ${instructions.avoidDiscounts}`,
      ],
    },
    {
      title: 'Visitor',
      lines: [
        'Safe summary only. Raw browser events are intentionally excluded.',
        `Confidence: ${visitor.confidence.band} (${visitor.confidence.score})`,
      ],
    },
    {
      title: 'Behaviour',
      lines: [
        `Dominant behaviour: ${visitor.behaviour.dominant}`,
        `Trajectory: ${visitor.behaviour.trajectory}`,
      ],
    },
    {
      title: 'Intent',
      lines: [
        `Goal: ${visitor.intent.goal}`,
        `Readiness: ${visitor.intent.readiness}`,
        `Conflict: ${visitor.intent.conflict}`,
      ],
    },
    {
      title: 'Strategy',
      lines: [
        `Approved strategy: ${strategy.kind}`,
        `Tone: ${strategy.tone}`,
        `CTA intent: ${strategy.ctaIntent}`,
        `Reason: ${strategy.reason}`,
      ],
    },
    {
      title: 'Knowledge',
      lines: renderKnowledgeLines(knowledge),
    },
    {
      title: 'Constraints',
      lines: [
        `Title max characters: ${MAX_POPUP_TITLE_LENGTH}`,
        `Body max characters: ${MAX_POPUP_BODY_LENGTH}`,
        `CTA max characters: ${MAX_POPUP_CTA_LENGTH}`,
        'Body must be one or two short sentences.',
        'CTA must match the CTA intent; do not introduce a different action.',
        ctaGuidanceFor(strategy.ctaIntent),
        instructions.avoidDiscounts ? 'Do not offer, imply, or mention discounts.' : 'Do not invent discounts or special offers.',
        instructions.alwaysBookDemo ? 'When appropriate, steer buying intent toward a demo/contact action.' : 'Do not force a demo if the strategy suggests education, comparison, support, or pricing discussion.',
      ],
    },
    {
      title: 'Output Format',
      lines: [
        'Return JSON with exactly these fields: title, body, cta, tone, popupType.',
        `tone must be: ${strategy.tone}`,
        `popupType should be: ${popupTypeFor(strategy.kind)}`,
        'Do not include showPopup, confidence, raw events, debug fields, or explanations.',
      ],
    },
  ];
}

function ctaGuidanceFor(intent: ConversationStrategy['ctaIntent']): string {
  switch (intent) {
    case 'capture_lead':
      return 'For capture_lead CTAs, use a short lead action such as Request a Consultation, Talk to an Expert, Claim Gift Code, Get Started, Join Now, Access Details, Contact Us, or Send a Message.';
    case 'discuss_pricing':
      return 'For discuss_pricing CTAs, use pricing/plan/cost language such as Discuss Pricing or Talk Pricing.';
    case 'book_demo':
      return 'For book_demo CTAs, use demo booking language such as Book a Demo or Schedule Demo.';
    case 'book_appointment':
      return 'For book_appointment CTAs, use appointment language such as Book Appointment or Schedule a Visit.';
    case 'compare_options':
      return 'For compare_options CTAs, use comparison language such as Compare Options or Compare Plans.';
    case 'offer_support':
      return 'For offer_support CTAs, use help/support language such as Get Help or Ask a Question.';
    case 'learn_more':
    default:
      return 'For learn_more CTAs, use education language such as Learn More, Explore Details, or See More.';
  }
}

function renderKnowledgeLines(knowledge: StrategyKnowledgeResult): string[] {
  if (!knowledge.knowledgeAvailable || knowledge.chunks.length === 0) {
    return [
      `Knowledge query: ${knowledge.query}`,
      `Knowledge available: false (${knowledge.unavailableReason ?? 'unknown'})`,
      'Do not fabricate facts. Use a modest offer to help or connect the visitor with the team.',
    ];
  }

  return [
    `Knowledge query: ${knowledge.query}`,
    'Use only these relevant facts:',
    ...knowledge.chunks.map(renderChunk),
  ];
}

function renderChunk(chunk: StrategyKnowledgeChunk, index: number): string {
  return `[${index + 1}] ${chunk.heading} (${chunk.pageType}, score ${chunk.score})\n${chunk.content}`;
}

function renderSections(sections: PromptSection[]): string {
  return sections
    .map((section) => [`## ${section.title}`, ...section.lines.map((line) => `- ${line}`)].join('\n'))
    .join('\n\n');
}

function popupTypeFor(strategy: ConversationStrategyKind): PopupType {
  switch (strategy) {
    case 'ReducePriceAnxiety':
      return 'pricing';
    case 'BuildTrust':
      return 'trust';
    case 'Compare':
      return 'comparison';
    case 'BookDemo':
    case 'BookAppointment':
      return 'booking';
    case 'Support':
      return 'support';
    case 'GenerateLead':
      return 'lead';
    case 'Educate':
    default:
      return 'educational';
  }
}
