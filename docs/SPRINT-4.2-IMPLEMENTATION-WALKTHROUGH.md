# Sprint 4.2 Implementation Walkthrough

## Purpose

Sprint 4.2 gives the AI Sales Brain a safe and controlled "mouth."

Sprint 4.1 remains the frozen perception dependency:

```text
Semantic Events
-> Behaviour Engine
-> Intent Engine
-> Confidence Engine
-> Sales Brain
```

Sprint 4.2 starts only after the deterministic Sales Brain has already decided whether speaking is appropriate. The LLM is never allowed to decide whether to interrupt. The LLM only generates language after deterministic strategy, retrieval, prompt, and safety gates succeed.

The Sprint 4.2 pipeline implemented is:

```text
Semantic Events
-> Behaviour Engine
-> Intent Engine
-> Confidence Engine
-> Sales Brain
-> Conversation Strategy
-> Knowledge Retrieval
-> Prompt Builder
-> Safety Validation
-> LLM
-> Response Validation
-> Popup
```

## Non-Negotiables Preserved

- Sprint 4.1 was not redesigned.
- The Sales Brain is not bypassed.
- The widget does not call the LLM.
- The LLM does not decide interruption.
- Raw browser events are not sent to the LLM.
- The LLM receives strategy, safe summaries, policy, and minimal relevant knowledge only.
- Popup generation occurs only after response validation succeeds.
- Visitor-visible activation remains intentionally unwired in this implementation.

## Component 1: Conversation Strategy Layer

### File Added

`backend/src/intelligence/conversationStrategy.ts`

### Purpose

Converts a deterministic `SalesDecision` into a communication strategy.

### What It Does

- Returns `null` when the Sales Brain is silent or suppressed.
- Maps Sales Brain output into one of the approved strategy families:
  - `Educate`
  - `Compare`
  - `ReducePriceAnxiety`
  - `BuildTrust`
  - `BookDemo`
  - `BookAppointment`
  - `GenerateLead`
  - `Support`
- Carries safe summaries only:
  - dominant behaviour
  - behaviour trajectory
  - intent goal
  - readiness
  - conflict flag
  - confidence score and band
  - business objective metadata
- Does not include raw semantic events.
- Does not call the LLM.
- Does not generate visitor-facing copy.

### Tests Added

`backend/src/intelligence/__tests__/conversationStrategy.test.ts`

Coverage includes:

- Silent Sales Brain decisions produce no strategy.
- Price-sensitive visitors map to `ReducePriceAnxiety`.
- Trust-seeking visitors map to `BuildTrust`.
- Appointment/demo objectives map to booking strategies.
- Strategy output excludes raw event names.

## Component 2: Knowledge Retrieval

### File Added

`backend/src/intelligence/knowledgeRetrieval.ts`

### Purpose

Retrieves the minimum relevant RAG knowledge for the approved conversation strategy.

### What It Does

- Builds a compact retrieval query from:
  - business objective
  - strategy
  - CTA intent
  - behaviour summary
  - intent summary
  - confidence band
- Uses the existing RAG `retrieve()` boundary.
- Caps output to a small number of chunks.
- Caps total knowledge text length.
- Returns:
  - query
  - `knowledgeAvailable`
  - kept chunks
  - scores
  - unavailable reason
- Does not expose raw browser events.
- Does not generate copy.

### Tests Added

`backend/src/intelligence/__tests__/knowledgeRetrieval.test.ts`

Coverage includes:

- Strategy-safe query generation.
- Existing RAG boundary is called with the expected query and website id.
- Minimal knowledge trimming.
- Missing knowledge is reported without throwing.
- Raw event names are excluded.

## Component 3: Prompt Builder

### Files Added or Updated

- `backend/src/validation/popupSchema.ts`
- `backend/src/prompts/popupPromptBuilder.ts`
- `backend/src/prompts/registry.ts`

### Purpose

Builds a structured language-only prompt for popup copy generation.

### What It Does

- Registers a new prompt version: `popup-v1`.
- Defines a popup language schema with:
  - `title`
  - `body`
  - `cta`
  - `tone`
  - `popupType`
- Separates prompt sections:
  - Business
  - Visitor
  - Behaviour
  - Intent
  - Strategy
  - Knowledge
  - Constraints
  - Output Format
- Explicitly excludes:
  - raw events
  - `showPopup`
  - confidence decision fields
  - debug fields
  - interruption decision authority
- Tells the model to use only provided knowledge.
- Tells the model not to invent pricing, guarantees, features, case studies, or policies.

### Tests Added

`backend/src/prompts/__tests__/popupPromptBuilder.test.ts`

Coverage includes:

- Required prompt sections are present.
- Schema is language-only.
- Strategy, knowledge, and owner policy are included.
- Raw semantic event names are excluded.
- Missing knowledge tells the model not to fabricate.

## Component 4: Safety Layer

### File Added

`backend/src/intelligence/safetyLayer.ts`

### Purpose

Deterministic pre-LLM gate.

### What It Does

Validates before any LLM call:

- Sales Brain chose `speak`.
- Sales Brain decision is not suppressed.
- Confidence is not low.
- Confidence score meets the minimum threshold.
- Strategy exists.
- Knowledge exists.
- CTA intent is allowed for the strategy.
- Business policy is respected.
- Optional CTA allowlist can narrow allowed actions.

### Reject Reasons

- `sales_brain_not_speak`
- `low_confidence`
- `missing_strategy`
- `missing_knowledge`
- `cta_not_allowed`
- `business_policy`

### Tests Added

`backend/src/intelligence/__tests__/safetyLayer.test.ts`

Coverage includes:

- Valid speak decision passes.
- Silent Sales Brain decision fails.
- Low confidence fails.
- Missing knowledge fails.
- CTA mismatch fails.
- Support objective policy mismatch fails.
- CTA allowlist narrowing works.

## Component 5: LLM Adapter

### File Added

`backend/src/intelligence/popupLlmAdapter.ts`

### Purpose

Provider-independent LLM adapter for popup language generation.

### What It Does

- Uses the existing provider abstraction through `generateDecision()`.
- Does not expose provider details to the Sales Brain.
- Refuses to call the provider when safety fails.
- Refuses to call the provider when no LLM is available.
- Applies a timeout.
- Fails closed on timeout.
- Fails closed on provider errors.
- Returns raw untrusted output for response validation.
- Does not validate copy.
- Does not show or generate a popup artifact.

### Tests Added

`backend/src/intelligence/__tests__/popupLlmAdapter.test.ts`

Coverage includes:

- Provider is not called when safety rejects.
- Provider unavailable fails closed.
- Structured prompt is sent to the provider abstraction.
- Timeout fails closed.
- Provider error fails closed.

## Component 6: Response Validation

### Files Added or Updated

- `backend/src/intelligence/responseValidation.ts`
- `backend/src/intelligence/index.ts`

### Purpose

Validates raw popup language from the LLM before any visitor-facing rendering can exist.

### What It Does

- Accepts raw `PopupLlmResult`.
- Produces either trusted `ValidatedPopupLanguage` or a fail-closed fallback.
- Rejects malformed output.
- Rejects legacy decision-shaped output such as:
  - `showPopup`
  - `confidence`
  - `events`
  - `debug`
  - `reasoning`
- Enforces schema constraints.
- Enforces tone and popup type alignment with the approved strategy.
- Enforces CTA text alignment with the approved CTA intent.
- Sanitizes visitor-facing text by removing control characters and angle brackets.
- Rejects discount language when `avoidDiscounts` is true.
- Rejects invented pricing amounts.
- Rejects invented guarantees.
- Rejects unsupported specific claims when not present in retrieved knowledge.

### Reject Reasons

- `llm_failed`
- `malformed_response`
- `schema_violation`
- `strategy_mismatch`
- `cta_not_allowed`
- `business_policy`
- `invented_pricing`
- `invented_guarantee`
- `unsupported_claim`

### Tests Added

`backend/src/intelligence/__tests__/responseValidation.test.ts`

Coverage includes:

- Grounded strategy-matching popup language passes.
- LLM adapter failure suppresses.
- Malformed or legacy decision-shaped output fails.
- Strategy drift fails.
- CTA drift fails.
- Invented pricing fails.
- Invented guarantees fail.
- Unsupported claims fail.
- Discount language fails when policy forbids it.
- Support strategy accepts only support-aligned copy.

## Component 7: Popup Generation

### Files Added or Updated

- `backend/src/intelligence/popupGeneration.ts`
- `backend/src/intelligence/popupPipeline.ts`
- `backend/src/intelligence/index.ts`

### Purpose

Creates a backend-only popup artifact after every previous Sprint 4.2 stage succeeds.

### What `popupGeneration.ts` Does

- Accepts only `PopupResponseValidationResult`.
- Produces a `GeneratedPopup` only when validation succeeded.
- Suppresses popup generation when validation failed.
- Adds internal metadata:
  - `source: validated_llm`
  - selected strategy
  - approved CTA intent

### What `popupPipeline.ts` Does

Composes the safe Sprint 4.2 backend pipeline:

```text
Sales Brain decision
-> Conversation Strategy
-> Knowledge Retrieval
-> Safety Validation
-> Prompt Builder
-> LLM Adapter
-> Response Validation
-> Popup Generation
```

It:

- Starts from an existing `SalesDecision`.
- Builds strategy only if the Sales Brain chose `speak`.
- Retrieves strategy-scoped knowledge.
- Runs pre-LLM safety before prompt/LLM use.
- Builds the structured popup prompt.
- Calls the provider-independent LLM adapter.
- Validates the raw response.
- Generates the popup artifact only after validation succeeds.
- Stops fail-closed at the earliest failed stage.

### Tests Added

`backend/src/intelligence/__tests__/popupGeneration.test.ts`

Coverage includes:

- Popup artifact is produced only from validated language.
- Failed response validation suppresses popup generation.
- Full safe path returns a validated popup payload.
- Missing knowledge stops before prompt creation and before LLM call.
- Unsupported or invented LLM copy stops at response validation and suppresses popup generation.

## Public Exports Added

`backend/src/intelligence/index.ts`

Exports added for Sprint 4.2:

- `buildConversationStrategy`
- `retrieveStrategyKnowledge`
- `buildStrategyKnowledgeQuery`
- `validatePreLlmSafety`
- `generatePopupLanguage`
- `validatePopupResponse`
- `generatePopup`
- `generateSafePopup`

Relevant exported types were also added for each component.

## Generated File

`backend/public/widget.js`

This file was regenerated by `widget` build verification.

No widget source behavior was changed for Sprint 4.2.

## Final Verification

The following commands were run after the final Sprint 4.2 component:

```bash
cd backend
npm run typecheck
npm test

cd ../widget
npm run typecheck
npm run build
```

### Results

- Backend typecheck: passed.
- Backend tests: passed, `60/60`.
- Widget typecheck: passed.
- Widget build: passed.

### Sandbox Note

On Windows, `npm test` and widget `npm run build` initially failed inside the restricted sandbox with `spawn EPERM`.

Both commands were rerun outside the sandbox with approval and passed.

## Current Sprint 4.2 State

Sprint 4.2 now has a complete backend-safe popup generation path:

1. Conversation Strategy Layer
2. Knowledge Retrieval
3. Prompt Builder
4. Safety Layer
5. LLM Adapter
6. Response Validation
7. Popup Generation

The AI can now produce a validated popup artifact only after:

- the deterministic Sales Brain chooses `speak`,
- relevant knowledge is available,
- safety validation passes,
- the structured prompt is built,
- the LLM returns language,
- response validation approves the language.

## What Is Not Implemented

The following were intentionally not implemented:

- Sprint 4.1 redesigns
- learning systems
- analytics
- A/B testing
- CRM
- email
- WhatsApp
- voice
- human handoff
- revenue reports
- dashboard changes
- widget-side LLM calls
- direct raw-event prompting
- LLM-controlled interruption decisions

## Important Activation Note

Sprint 4.2 created the safe backend popup-generation path, but visitor-visible activation remains intentionally unwired.

That means:

- `/events` still remains a resilient perception endpoint.
- Sprint 4.1 shadow-mode behavior is preserved.
- The widget does not automatically render these generated popup artifacts.
- No popup is shown to visitors unless a later explicit integration step wires the validated popup artifact into a visitor-facing surface.
