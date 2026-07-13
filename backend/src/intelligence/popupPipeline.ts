/**
 * Sprint 4.2 popup pipeline.
 *
 * Composes the completed 4.2 layers after the Sprint 4.1 Sales Brain has
 * already made its deterministic decision. This function is intentionally not
 * wired to /events yet; it gives the backend a safe "mouth" without changing
 * visitor-visible behavior until the product surface opts in later.
 */
import type { BusinessInstructions } from '../context/types.js';
import type { BusinessActionConfig } from '../business-actions/action.types.js';
import { popupPromptBuilder } from '../prompts/popupPromptBuilder.js';
import { buildConversationStrategy, type ConversationStrategy } from './conversationStrategy.js';
import { retrieveStrategyKnowledge, type StrategyKnowledgeOptions, type StrategyKnowledgeResult } from './knowledgeRetrieval.js';
import { generatePopup, type PopupGenerationResult } from './popupGeneration.js';
import { generatePopupLanguage, type PopupLlmOptions, type PopupLlmResult } from './popupLlmAdapter.js';
import { validatePopupResponse, type PopupResponseValidationResult } from './responseValidation.js';
import { validatePreLlmSafety, type PreLlmSafetyResult } from './safetyLayer.js';
import type { BusinessObjective, SalesDecision } from './types.js';

export type PopupPipelineStage =
  | 'strategy'
  | 'knowledge'
  | 'safety'
  | 'prompt'
  | 'llm'
  | 'response_validation'
  | 'popup_generation';

export interface GenerateSafePopupInput {
  decision: SalesDecision;
  objective: BusinessObjective;
  business: {
    name: string;
  };
  instructions: BusinessInstructions;
  websiteId?: string;
  businessActions?: BusinessActionConfig[];
}

export interface GenerateSafePopupOptions {
  knowledge?: StrategyKnowledgeOptions;
  llm?: PopupLlmOptions;
}

export interface PopupPipelineTrace {
  stages: PopupPipelineStage[];
  strategy: ConversationStrategy | null;
  knowledge: StrategyKnowledgeResult | null;
  safety: PreLlmSafetyResult | null;
  llm: PopupLlmResult | null;
  responseValidation: PopupResponseValidationResult | null;
}

export type SafePopupPipelineResult =
  | {
      ok: true;
      popup: PopupGenerationResult & { ok: true };
      trace: PopupPipelineTrace;
    }
  | {
      ok: false;
      popup: PopupGenerationResult | null;
      stoppedAt: PopupPipelineStage;
      reason: string;
      trace: PopupPipelineTrace;
    };

export async function generateSafePopup(
  input: GenerateSafePopupInput,
  opts: GenerateSafePopupOptions = {},
): Promise<SafePopupPipelineResult> {
  const stages: PopupPipelineStage[] = [];
  const trace: PopupPipelineTrace = {
    stages,
    strategy: null,
    knowledge: null,
    safety: null,
    llm: null,
    responseValidation: null,
  };

  stages.push('strategy');
  const strategy = buildConversationStrategy({ decision: input.decision, objective: input.objective });
  trace.strategy = strategy;
  if (!strategy) return stop('strategy', 'missing_strategy', trace, null);

  stages.push('knowledge');
  const knowledge = await retrieveStrategyKnowledge(strategy, { ...opts.knowledge, websiteId: opts.knowledge?.websiteId ?? input.websiteId });
  trace.knowledge = knowledge;

  stages.push('safety');
  const safety = validatePreLlmSafety({ decision: input.decision, strategy, knowledge, instructions: input.instructions });
  trace.safety = safety;
  if (!safety.ok) return stop('safety', safety.reasons.join(','), trace, null);

  stages.push('prompt');
  const prompt = popupPromptBuilder.build({
    business: { name: input.business.name, objectiveKey: input.objective.key },
    instructions: input.instructions,
    strategy,
    knowledge,
    businessActions: input.businessActions ?? [],
  });

  stages.push('llm');
  const llm = await generatePopupLanguage({ prompt, safety }, opts.llm);
  trace.llm = llm;
  if (!llm.ok) return stop('llm', llm.reason, trace, null);

  stages.push('response_validation');
  const responseValidation = validatePopupResponse({ llm, strategy, knowledge, instructions: input.instructions, enabledActions: input.businessActions ?? [] });
  trace.responseValidation = responseValidation;
  if (!responseValidation.ok) {
    const popup = generatePopup({ validation: responseValidation, strategy });
    return stop('response_validation', responseValidation.reasons.join(','), trace, popup);
  }

  stages.push('popup_generation');
  const popup = generatePopup({ validation: responseValidation, strategy });
  if (!popup.ok) return stop('popup_generation', popup.reason, trace, popup);

  return { ok: true, popup, trace };
}

function stop(
  stoppedAt: PopupPipelineStage,
  reason: string,
  trace: PopupPipelineTrace,
  popup: PopupGenerationResult | null,
): SafePopupPipelineResult {
  return { ok: false, popup, stoppedAt, reason, trace };
}
