/**
 * Strategy-aware Knowledge Retrieval (Sprint 4.2 component 2).
 *
 * Uses the existing RAG retrieval function, but builds the query only from the
 * Conversation Strategy and safe Sprint 4.1 summaries. Raw semantic events never
 * enter this layer, and this layer does not generate language or decide whether
 * to interrupt.
 */
import { retrieve } from '../context/retriever.js';
import type { RetrievedChunk } from '../context/types.js';
import type { ConversationStrategy } from './conversationStrategy.js';

export interface StrategyKnowledgeChunk {
  id: string;
  url: string;
  page: string;
  pageType: RetrievedChunk['pageType'];
  heading: string;
  content: string;
  score: number;
}

export interface StrategyKnowledgeResult {
  /** Query sent to RAG, useful for debug and prompt trace. */
  query: string;
  /** True only when at least one relevant chunk is available. */
  knowledgeAvailable: boolean;
  /** Minimal relevant knowledge for the strategy. */
  chunks: StrategyKnowledgeChunk[];
  /** Scores from kept chunks only. */
  scores: number[];
  /** Why knowledge is unavailable, if applicable. */
  unavailableReason: string | null;
}

export interface StrategyKnowledgeOptions {
  /** Per-website store id; omitted uses existing dev/global RAG store. */
  websiteId?: string;
  /** Keep prompts lean: default three chunks. */
  maxChunks?: number;
  /** Keep only enough text for a popup strategy, not a full chat answer. */
  maxChars?: number;
  /** Test seam; production uses existing RAG retrieve(). */
  retrieveFn?: (query: string, websiteId?: string) => Promise<{ chunks: RetrievedChunk[]; scores: number[] }>;
}

const DEFAULT_MAX_CHUNKS = 3;
const DEFAULT_MAX_CHARS = 1800;

export async function retrieveStrategyKnowledge(
  strategy: ConversationStrategy,
  opts: StrategyKnowledgeOptions = {},
): Promise<StrategyKnowledgeResult> {
  const query = buildStrategyKnowledgeQuery(strategy);
  const retrieveFn = opts.retrieveFn ?? retrieve;
  const { chunks } = await retrieveFn(query, opts.websiteId);
  const kept = keepMinimalKnowledge(chunks, opts.maxChunks ?? DEFAULT_MAX_CHUNKS, opts.maxChars ?? DEFAULT_MAX_CHARS);

  return {
    query,
    knowledgeAvailable: kept.length > 0,
    chunks: kept,
    scores: kept.map((c) => c.score),
    unavailableReason: kept.length > 0 ? null : 'no_relevant_knowledge',
  };
}

export function buildStrategyKnowledgeQuery(strategy: ConversationStrategy): string {
  const terms = strategyTerms(strategy);
  const parts = [
    strategy.business.objectiveKey,
    strategy.kind,
    strategy.ctaIntent,
    strategy.visitor.behaviour.dominant,
    strategy.visitor.intent.goal,
    strategy.visitor.intent.readiness,
    strategy.visitor.confidence.band,
    ...terms,
  ];

  return Array.from(new Set(parts.map((p) => p.trim()).filter(Boolean))).join(' ').slice(0, 400);
}

function keepMinimalKnowledge(chunks: RetrievedChunk[], maxChunks: number, maxChars: number): StrategyKnowledgeChunk[] {
  const kept: StrategyKnowledgeChunk[] = [];
  let remaining = Math.max(0, maxChars);

  for (const chunk of chunks) {
    if (kept.length >= Math.max(0, maxChunks)) break;
    if (remaining <= 0) break;

    const content = chunk.content.trim();
    if (!content) continue;

    const clipped = content.length > remaining ? content.slice(0, remaining).trimEnd() : content;
    if (!clipped) continue;

    kept.push({
      id: chunk.id,
      url: chunk.url,
      page: chunk.page,
      pageType: chunk.pageType,
      heading: chunk.heading,
      content: clipped,
      score: Number(chunk.score.toFixed(3)),
    });
    remaining -= clipped.length;
  }

  return kept;
}

function strategyTerms(strategy: ConversationStrategy): string[] {
  switch (strategy.kind) {
    case 'ReducePriceAnxiety':
      return ['pricing', 'plans', 'cost', 'value', 'faq'];
    case 'BuildTrust':
      return ['testimonials', 'case studies', 'security', 'about', 'guarantee'];
    case 'Compare':
      return ['features', 'services', 'plans', 'comparison'];
    case 'BookDemo':
      return ['demo', 'schedule', 'contact'];
    case 'BookAppointment':
      return ['appointment', 'booking', 'contact'];
    case 'Support':
      return ['support', 'help', 'faq', 'contact'];
    case 'GenerateLead':
      return ['contact', 'lead', 'consultation'];
    case 'Educate':
    default:
      return ['overview', 'services', 'faq'];
  }
}