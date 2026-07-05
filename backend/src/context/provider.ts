/**
 * Context Provider â€” the single source of truth for all AI context.
 *
 * Sprint 3: accepts an optional `tenant` parameter. When present, uses the
 * per-website store (registry) and DB-backed instructions. When absent, falls
 * back to the dev singleton + local instructions file (Sprint 2 compat).
 */
import { getBusinessInstructions } from './instructions.js';
import { buildBehaviourQuery, retrieve } from './retriever.js';
import { staticBusinessContext } from './staticContext.js';
import { getLoadedMeta, knowledgeReady } from '../vectorstore/index.js';
import { getWebsiteMeta, knowledgeReadyForWebsite } from '../vectorstore/registry.js';
import type { BusinessInstructions, ResolvedContext, RetrievedChunk } from './types.js';
import type { SiteLink, VisitorBehaviour } from '../types.js';

export interface ContextRequest {
  query: string;
  behaviour?: VisitorBehaviour;
  /** When set, uses per-website store + tenant instructions. */
  tenant?: {
    websiteId: string;
    instructions: BusinessInstructions;
  };
}

export async function getBusinessContext(req: ContextRequest): Promise<ResolvedContext> {
  const instructions = req.tenant?.instructions ?? getBusinessInstructions();
  const websiteId = req.tenant?.websiteId;
  const query = req.query?.trim() || (req.behaviour ? buildBehaviourQuery(req.behaviour) : '');

  const ready = websiteId ? await knowledgeReadyForWebsite(websiteId) : knowledgeReady();

  if (ready) {
    const { chunks, scores } = await retrieve(query, websiteId);
    const meta = websiteId ? await getWebsiteMeta(websiteId) : getLoadedMeta();
    if (chunks.length > 0) {
      return {
        business: { name: instructions.businessName },
        instructions,
        chunks,
        siteLinks: meta?.siteLinks ?? [],
        source: 'rag',
        scores,
      };
    }

    if (websiteId) {
      console.warn(`[knowledge] tenant ${websiteId.slice(0, 8)} returned no chunks for query="${query.slice(0, 60)}" — no global fallback allowed.`);
      return buildTenantEmptyContext(instructions, meta?.siteLinks ?? []);
    }

    console.warn(`[knowledge] no chunks passed threshold for query="${query.slice(0, 60)}" — using fallback.`);
  } else {
    if (websiteId) {
      const meta = await getWebsiteMeta(websiteId);
      console.warn(`[knowledge] tenant index not ready (website ${websiteId.slice(0, 8)}) — no global fallback allowed.`);
      return buildTenantEmptyContext(instructions, meta?.siteLinks ?? []);
    }

    console.warn('[knowledge] index not ready — using fallback.');
  }

  return buildFallback(instructions);
}

function buildTenantEmptyContext(instructions: BusinessInstructions, siteLinks: SiteLink[]): ResolvedContext {
  return {
    business: { name: instructions.businessName },
    instructions,
    chunks: [],
    siteLinks,
    source: 'rag',
    scores: [],
  };
}
function buildFallback(instructions?: BusinessInstructions): ResolvedContext {
  const s = staticBusinessContext;
  const instr = instructions ?? getBusinessInstructions();
  const now = new Date().toISOString();
  const chunks: RetrievedChunk[] = [];
  let i = 0;
  const push = (heading: string, content: string) => {
    if (!content.trim()) return;
    chunks.push({
      id: `static#${i}`,
      page: '/',
      url: '/',
      pageType: 'other',
      section: heading.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      heading,
      title: s.name,
      language: 'English',
      hash: '',
      lastCrawled: now,
      content,
      score: 1,
    });
    i += 1;
  };

  push('About', `${s.description}${s.positioning ? `\n\n${s.positioning}` : ''}`);
  push('Services', s.services.join('\n- '));
  if (s.pricingSummary) push('Pricing', s.pricingSummary);
  for (const f of s.faqs ?? []) push(`FAQ: ${f.q}`, f.a);
  if (s.contact) push('Contact', s.contact);

  const siteLinks: SiteLink[] = s.siteLinks ?? [];

  return {
    business: { name: s.name, description: s.description },
    instructions: instr,
    chunks,
    siteLinks,
    source: 'fallback',
    scores: chunks.map(() => 1),
  };
}

