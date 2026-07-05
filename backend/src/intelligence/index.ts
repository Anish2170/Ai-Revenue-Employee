/**
 * Intelligence core — public barrel (Sprint 4).
 *
 * The device-blind perception stack from
 * docs/SPRINT-4-INTELLIGENCE-ARCHITECTURE.md. Everything above the widget edge
 * imports from here; the individual layer modules stay internal.
 */
export * from './types.js';
export { runBehaviourEngine } from './behaviourEngine.js';
export { runIntentEngine } from './intentEngine.js';
export { computeConfidence } from './confidence.js';
export { runSalesBrain, type BrainInput } from './salesBrain.js';
export { perceive, type PerceiveInput } from './perceive.js';
export { buildConversationStrategy, type ConversationStrategy, type ConversationStrategyInput, type ConversationStrategyKind } from './conversationStrategy.js';
export { retrieveStrategyKnowledge, buildStrategyKnowledgeQuery, type StrategyKnowledgeResult, type StrategyKnowledgeChunk, type StrategyKnowledgeOptions } from './knowledgeRetrieval.js';
export { validatePreLlmSafety, type PreLlmSafetyInput, type PreLlmSafetyResult, type SafetyRejectReason } from './safetyLayer.js';
export { generatePopupLanguage, type PopupLlmInput, type PopupLlmOptions, type PopupLlmResult, type PopupLlmRejectReason } from './popupLlmAdapter.js';
export { validatePopupResponse, type PopupResponseValidationInput, type PopupResponseValidationResult, type PopupResponseRejectReason, type ValidatedPopupLanguage } from './responseValidation.js';
export { generatePopup, type GeneratedPopup, type PopupGenerationInput, type PopupGenerationRejectReason, type PopupGenerationResult } from './popupGeneration.js';
export { generateSafePopup, type GenerateSafePopupInput, type GenerateSafePopupOptions, type PopupPipelineStage, type PopupPipelineTrace, type SafePopupPipelineResult } from './popupPipeline.js';
