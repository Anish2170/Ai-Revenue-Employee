/**
 * Context Provider - the single source of truth for all AI context.
 *
 * Sprint 3: accepts an optional `tenant` parameter. When present, uses the
 * per-website store (registry) and DB-backed instructions. When absent, falls
 * back to the dev singleton + local instructions file (Sprint 2 compat).
 */
import { getBusinessInstructions } from './instructions.js';
import { buildBehaviourQuery, retrieve } from './retriever.js';
import { staticBusinessContext } from './staticContext.js';
import { getLoadedMeta, knowledgeReady } from '../vectorstore/index.js';
import { getWebsiteStore, getWebsiteMeta, knowledgeReadyForWebsite } from '../vectorstore/registry.js';
import type { BusinessInstructions, ResolvedContext, RetrievedChunk } from './types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import type { SiteLink, VisitorBehaviour } from '../types.js';
import { logger } from '../logging/logger.js';
import type {RetrievalPage} from './retrievalPlan.js';

export interface ContextRequest {
  signal?: AbortSignal;
  deadlineAt?: number;
  query: string;
  page?:RetrievalPage;
  history?:string[];
  purpose?:'chat'|'popup';
  behaviour?: VisitorBehaviour;
  /** When set, uses per-website store + tenant instructions. */
  tenant?: {
    websiteId: string;
    instructions: BusinessInstructions;
    businessActions?: BusinessActionConfig[];
  };
}

export async function getBusinessContext(req: ContextRequest): Promise<ResolvedContext> {
  const instructions = req.tenant?.instructions ?? getBusinessInstructions();
  const businessActions = req.tenant?.businessActions ?? [];
  const websiteId = req.tenant?.websiteId;
  const query = req.query?.trim() || (req.behaviour ? buildBehaviourQuery(req.behaviour) : '');

  const pinned=websiteId?await getWebsiteStore(websiteId):null;
  // A configured website-origin change does not authorize the previous site's
  // facts. Keep the artifact for rollback, but do not serve it as the new site.
  if(pinned?.meta && instructions.websiteUrl){
    let matches=false;
    try{matches=new URL(pinned.meta.sourceUrl).origin===new URL(instructions.websiteUrl).origin;}catch{}
    if(!matches)return buildTenantEmptyContext(instructions,[],businessActions);
  }
  const ready=pinned?pinned.store.size()>0:knowledgeReady();

  if (ready) {
    const { chunks, scores,diagnostics } = await retrieve(query, websiteId, { signal: req.signal, deadlineAt: req.deadlineAt, pinnedStore:pinned?.store,sourceUrl:pinned?.meta?.sourceUrl??instructions.websiteUrl,activeVersion:pinned?.meta?.activeVersion,page:req.page??(req.behaviour?{path:req.behaviour.page}:undefined),history:req.history,purpose:req.purpose });
    const meta = pinned?.meta ?? (websiteId ? null : getLoadedMeta());
    if (chunks.length > 0) {
      return {
        business: { name: instructions.businessName },
        instructions,
        chunks,
        siteLinks: meta?.siteLinks ?? [],
        businessActions,
        source: 'rag',
        scores,
        retrieval:diagnostics,
      };
    }

    if (websiteId) {
      logger.warn('[knowledge] tenant returned no chunks; no global fallback allowed', { websiteId });
      return {...buildTenantEmptyContext(instructions, meta?.siteLinks ?? [], businessActions),retrieval:diagnostics};
    }

    logger.warn('[knowledge] no chunks passed threshold; using fallback');
  } else {
    if (websiteId) {
      const meta = await getWebsiteMeta(websiteId);
      logger.warn('[knowledge] tenant index not ready; no global fallback allowed', { websiteId });
      return buildTenantEmptyContext(instructions, meta?.siteLinks ?? [], businessActions);
    }

    console.warn('[knowledge] index not ready - using fallback.');
  }

  return buildFallback(instructions, businessActions);
}

function buildTenantEmptyContext(
  instructions: BusinessInstructions,
  siteLinks: SiteLink[],
  businessActions: BusinessActionConfig[] = [],
): ResolvedContext {
  return {
    business: { name: instructions.businessName },
    instructions,
    chunks: [],
    siteLinks,
    businessActions,
    source: 'rag',
    scores: [],
  };
}

function buildFallback(instructions?: BusinessInstructions, businessActions: BusinessActionConfig[] = []): ResolvedContext {
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
    businessActions,
    source: 'fallback',
    scores: chunks.map(() => 1),
  };
}
