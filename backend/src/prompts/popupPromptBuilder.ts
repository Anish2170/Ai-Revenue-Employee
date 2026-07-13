/**
 * Popup prompt builder (Sprint 4.2 component 3).
 *
 * Builds a structured prompt for language generation only. The prompt receives
 * conversation strategy, minimal knowledge, enabled business actions, and safe
 * summaries from Sprint 4.1; it never asks the model to create destinations.
 */
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import type { BusinessInstructions } from '../context/types.js';
import type { ConversationStrategy, ConversationStrategyKind } from '../intelligence/conversationStrategy.js';
import type { StrategyKnowledgeChunk, StrategyKnowledgeResult } from '../intelligence/knowledgeRetrieval.js';
import {
  MAX_POPUP_ACTION_ID_LENGTH,
  MAX_POPUP_BODY_LENGTH,
  MAX_POPUP_TITLE_LENGTH,
  popupJsonSchema,
  type PopupType,
} from '../validation/popupSchema.js';
import { renderBusinessActions, renderInstructions } from './shared.js';

export interface PopupPromptInput {
  business: {
    name: string;
    objectiveKey: string;
  };
  instructions: BusinessInstructions;
  strategy: ConversationStrategy;
  knowledge: StrategyKnowledgeResult;
  businessActions?: BusinessActionConfig[];
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
          'Your only job is to generate concise popup language and choose an enabled business action when one fits.',
        ],
      },
      {
        title: 'Hard Rules',
        lines: [
          'Do not decide whether to interrupt. That decision has already been made.',
          'Do not mention internal labels, confidence scores, behaviour states, or strategy names to the visitor.',
          'Use only the provided knowledge. Do not invent pricing, guarantees, features, case studies, or policies.',
          'If knowledge is missing or thin, write a modest offer to help instead of making a factual claim.',
          'Never generate URLs, phone numbers, email addresses, WhatsApp numbers, or CTA labels.',
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
  const businessActions = input.businessActions ?? [];
  const visitor = strategy.visitor;

  return [
    {
      title: 'Business',
      lines: [
        `Name: ${business.name}`,
        `Objective: ${business.objectiveKey}`,
        ...renderInstructions(instructions).split('\n'),
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
      title: 'Business Actions',
      lines: renderBusinessActions(businessActions).split('\n'),
    },
    {
      title: 'Constraints',
      lines: [
        `Title max characters: ${MAX_POPUP_TITLE_LENGTH}`,
        `Body max characters: ${MAX_POPUP_BODY_LENGTH}`,
        `Action ID max characters: ${MAX_POPUP_ACTION_ID_LENGTH}`,
        'Body must be one or two short sentences.',
        'If a configured action matches the strategy, set primaryAction to that exact Action ID.',
        'For comparison, pricing, booking, lead, and support popups, choose an enabled primaryAction when one fits.',
        'Only educational and trust popups may leave primaryAction and secondaryAction empty.',
        'Never invent action IDs and never generate destinations or labels.',
        instructions.avoidDiscounts ? 'Do not offer, imply, or mention discounts.' : 'Do not invent discounts or special offers.',
        instructions.alwaysBookDemo ? 'When appropriate, choose an enabled demo/contact action if one exists.' : 'Do not force an action if the strategy suggests education, comparison, support, or pricing discussion.',
      ],
    },
    {
      title: 'Output Format',
      lines: [
        'Return JSON with exactly these fields: title, body, primaryAction, secondaryAction, tone, popupType.',
        `tone must be: ${strategy.tone}`,
        `popupType should be: ${popupTypeFor(strategy.kind)}`,
        'Do not include cta, ctaUrl, destination, showPopup, confidence, raw events, debug fields, or explanations.',
      ],
    },
  ];
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



