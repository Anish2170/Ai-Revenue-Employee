import type { ResolvedContext } from '../context/types.js';
import type { EngageDecision, VisitorBehaviour } from '../types.js';
import { buildPopupCopyPlan, checkPopupGrounding } from './popupGrounding.js';
import { MAX_POPUP_BODY_LENGTH } from '../validation/popupSchema.js';
import { publicPopupAction, popupCompatibleActions, resolvePopupAction, type PopupActionStrategy } from './popupActionPolicy.js';

/** The legacy endpoint shares the same authoring and CTA policy, without
 * accepting model-authored URLs/labels as a second authorization channel. */
export function legacyPopupPlan(context: ResolvedContext, behaviour: VisitorBehaviour) {
  const goal = context.instructions.goal?.toLowerCase() ?? '';
  const kind = behaviour.formInteracted || /support/.test(goal) ? 'Support'
    : /pricing|plans/.test(behaviour.page) ? 'ReducePriceAnxiety'
    : /appointment/.test(goal) ? 'BookAppointment'
    : /demo/.test(goal) ? 'BookDemo'
    : /buy|sell|purchase|lead/.test(goal) ? 'GenerateLead' : 'Educate';
  const strategy: PopupActionStrategy = { kind, business: { objectiveKey: goal, goalValue: 0, isSupport: kind === 'Support' } };
  const copy = buildPopupCopyPlan({ query: '', knowledgeAvailable: context.chunks.length > 0,
    chunks: context.chunks, scores: context.scores, unavailableReason: null }, context.instructions, { pagePath: behaviour.page });
  const actionContext = { websiteId: context.websiteId, websiteUrl: context.instructions.websiteUrl, businessName: context.instructions.businessName };
  return { strategy, copy, actionContext, primary: popupCompatibleActions(context.businessActions, strategy, context.instructions, false, undefined, actionContext),
    secondary: popupCompatibleActions(context.businessActions, strategy, context.instructions, true, undefined, actionContext) };
}

export function validateLegacyPopupSafety(raw: unknown, decision: EngageDecision, context: ResolvedContext, behaviour: VisitorBehaviour): EngageDecision {
  if (!decision.showPopup) return decision;
  if (context.retrieval?.conflicts.length) return {showPopup:false};
  const plan = legacyPopupPlan(context, behaviour);
  const grounding = checkPopupGrounding(plan.copy.titles[0] ?? '', decision.message ?? '', plan.copy);
  if (!grounding.ok || grounding.body.length > MAX_POPUP_BODY_LENGTH) return { showPopup: false };
  const message = grounding.body;
  const fields = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  // Unresolved raw IDs must not disappear in the structural parser and then
  // accidentally become a successful fallback.
  const resolve = (key: 'primaryAction' | 'secondaryAction', secondary: boolean) => {
    const value = fields[key];
    return typeof value === 'string' ? resolvePopupAction(context.businessActions, value, plan.strategy, context.instructions, secondary, message, plan.actionContext) : null;
  };
  const primary = resolve('primaryAction', false);
  const secondary = resolve('secondaryAction', true);
  if ((fields.primaryAction && !primary) || (fields.secondaryAction && !secondary)) return { showPopup: false };
  // Explicit legacy labels/URLs require an exact configured action. Never
  // reinterpret an arbitrary enabled URL as strategic authorization.
  const matchedLegacy = !fields.primaryAction && (fields.cta || fields.ctaUrl)
    ? plan.primary.find(action => action.label === fields.cta && (!fields.ctaUrl || action.destination === fields.ctaUrl)) : null;
  const action = primary ?? matchedLegacy ?? (!fields.cta && !fields.ctaUrl ? popupCompatibleActions(context.businessActions, plan.strategy, context.instructions, false, message, plan.actionContext)[0] : null);
  if (!action || !resolvePopupAction(context.businessActions, action.actionId, plan.strategy, context.instructions, false, message, plan.actionContext)) return { showPopup: false };
  return { showPopup: true, message, intent: decision.intent, confidence: decision.confidence,
    primaryAction: action.actionId, action: publicPopupAction(action), cta: action.label, ...(secondary ? { secondaryAction: secondary.actionId } : {}) };
}
