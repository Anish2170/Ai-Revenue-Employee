/**
 * Perception orchestrator (§2, §7.1).
 *
 * Ties the deterministic layers into one call:
 *
 *   events → Behaviour Engine → Intent Engine → Confidence → Sales Brain
 *
 * This is the "reasoning chain" of §7.1, stages 1–7 and the final gate. Stage 8
 * (LLM strategy + message) is intentionally NOT here — Sprint 4.1 is shadow
 * mode: we perceive and decide, but never speak.
 *
 * Pure and deterministic given (events, now, context, objective).
 */
import { runBehaviourEngine } from './behaviourEngine.js';
import { runIntentEngine } from './intentEngine.js';
import { computeConfidence } from './confidence.js';
import { runSalesBrain } from './salesBrain.js';
import {
  type BusinessObjective,
  type PerceptionContext,
  type SalesDecision,
  type SemanticEvent,
  type Surface,
} from './types.js';

export interface PerceiveInput {
  events: readonly SemanticEvent[];
  now: number;
  context: PerceptionContext;
  objective: BusinessObjective;
  /** Dominant surface for this session (tuning constant for the speak threshold). */
  surface: Surface;
  /** Sprint 4.2 supplies the real RAG knowledge check; defaults true in 4.1. */
  knowledgeOk?: boolean;
  /** Shadow mode — default true in Sprint 4.1. */
  shadow?: boolean;
}

/**
 * Run the full perception loop and return the Sales Brain's decision (with its
 * full reason trace). In shadow mode the decision is meant to be logged, not
 * enacted.
 */
export function perceive(input: PerceiveInput): SalesDecision {
  const behaviour = runBehaviourEngine(input.events, input.now);
  const intent = runIntentEngine(behaviour, input.context.returning);
  const confidence = computeConfidence(behaviour, intent, input.events, input.now);

  return runSalesBrain({
    behaviour,
    intent,
    confidence,
    context: input.context,
    objective: input.objective,
    surface: input.surface,
    now: input.now,
    knowledgeOk: input.knowledgeOk,
    shadow: input.shadow ?? true,
  });
}
