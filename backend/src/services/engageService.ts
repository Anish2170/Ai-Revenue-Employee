/**
 * Engage service — orchestrates the full /engage pipeline.
 *
 *   rules.shouldEvaluate (pre-LLM gate)
 *     → getBusinessContext
 *     → summarize
 *     → buildPrompt → llm.generateDecision
 *     → validate + sanitize
 *     → rules.finalizeDecision (post-LLM gate)
 *
 * Every exit path returns a safe {@link EngageDecision}; the widget can never be
 * broken by this endpoint. A dev-only decision trace is attached when enabled.
 */
import { getEnabledBusinessActions } from '../business-actions/action.service.js';
import { validateLegacyPopupSafety } from '../intelligence/legacyPopupSafety.js';
import { config } from '../config/index.js';
import { getBusinessContext } from '../context/provider.js';
import { buildBehaviourQuery } from '../context/retriever.js';
import { summarize } from '../behaviour/summarizer.js';
import { promptRegistry } from '../prompts/registry.js';
import { finalizeDecision, shouldEvaluate } from '../rules/rulesEngine.js';
import { validateEngageDecision } from '../validation/responseValidator.js';
import { generateDecision, llmAvailable } from '../llm/index.js';
import type {
  DecisionTrace,
  EngageDecision,
  SessionState,
  VisitorBehaviour,
} from '../types.js';
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import { abortable, checkCancelled } from '../llm/cancellation.js';

export interface EngageOptions {
  signal?: AbortSignal;
  deadlineAt?: number;
  tenant?: { websiteId: string; instructions: BusinessInstructions; businessActions?: BusinessActionConfig[] };
}

function withTrace(decision: EngageDecision, trace: DecisionTrace): EngageDecision {
  return config.debugTrace ? { ...decision, debug: trace } : decision;
}

export async function evaluateEngagement(
  behaviour: VisitorBehaviour,
  session: SessionState,
  opts: EngageOptions = {},
): Promise<EngageDecision> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  // 1. Pre-LLM gate — short-circuit cheap / ineligible traffic.
  const gate = shouldEvaluate(behaviour, session);
  if (!gate.proceed) {
    return withTrace(
      { showPopup: false },
      { ruleMatched: gate.ruleMatched, llmCalled: false, reason: gate.reason, processingTimeMs: elapsed() },
    );
  }

  // No provider configured → degrade gracefully (never throw to the widget).
  if (!llmAvailable()) {
    return withTrace(
      { showPopup: false },
      { ruleMatched: gate.ruleMatched, llmCalled: false, reason: 'LLM not configured; skipping engagement.', processingTimeMs: elapsed() },
    );
  }

  const builder = promptRegistry.engage.active;

  try {
    // 2–4. Retrieve RAG context for this visitor → summary → prompt → LLM.
    const context = await abortable(getBusinessContext({ query: buildBehaviourQuery(behaviour), behaviour, tenant: opts.tenant, signal: opts.signal, deadlineAt: opts.deadlineAt,purpose:'popup',page:{path:behaviour.page} }), opts.signal);
    context.websiteId = opts.tenant?.websiteId;
    checkCancelled(opts.signal);
    if (context.retrieval?.conflicts.length) return withTrace({showPopup:false}, {
      ruleMatched:gate.ruleMatched,llmCalled:false,reason:'Conflicting knowledge; engagement withheld.',processingTimeMs:elapsed(),
    });
    const summary = summarize(behaviour);
    const prompt = builder.build(context, behaviour, summary, gate);

    const raw = await generateDecision({
      signal: opts.signal,
      deadlineAt: opts.deadlineAt,
      system: prompt.system,
      user: prompt.user,
      schema: prompt.schema,
    });

    if (opts.tenant) context.businessActions = await abortable(getEnabledBusinessActions(opts.tenant.websiteId, { skipSeed: true }), opts.signal);
    checkCancelled(opts.signal);
    // 5. Validate + sanitize (CTA url allowlisted; never navigate to current page).
    const allowedUrls = (context.siteLinks ?? []).map((l) => l.url);
    const structured = validateEngageDecision(raw, allowedUrls, behaviour.page, context.businessActions);
    const validated = validateLegacyPopupSafety(raw, structured, context, behaviour);

    // 6. Post-LLM gate — confidence floor + dedup.
    const final = finalizeDecision(validated, session);

    return withTrace(final, {
      ruleMatched: gate.ruleMatched,
      llmCalled: true,
      reason: final.showPopup
        ? `Engaged: ${final.intent ?? 'unknown'} (confidence ${final.confidence ?? 0}).`
        : 'LLM or post-gate declined to engage.',
      promptVersion: builder.version,
      knowledgeSource: context.source,
      retrievalScores: context.scores,
      processingTimeMs: elapsed(),
    });
  } catch (err) {
    // Any LLM/parse failure degrades to a safe no-popup.
    const reason = err instanceof Error ? err.message : 'Unknown LLM error';
    return withTrace(
      { showPopup: false },
      { ruleMatched: gate.ruleMatched, llmCalled: true, reason: `LLM error: ${reason}`, promptVersion: builder.version, processingTimeMs: elapsed() },
    );
  }
}
