# Sprint 4.1 Compliance Walkthrough

## Purpose

This document records the final Sprint 4.1 compliance changes made after QA identified two remaining issues:

1. The active widget could still execute the legacy engagement pipeline.
2. The `/events` endpoint returned HTTP 400 for malformed request envelopes.

The goal was not to redesign Sprint 4.1 or start Sprint 4.2. The goal was to make the smallest possible changes needed for Sprint 4.1 to fully match the frozen shadow-mode architecture.

## Issue 1: Legacy Engagement Path Could Still Reach Visitors

### Problem

The widget still had the legacy Sprint 1-3 engagement path active by default. That path could:

- Start the old tracker.
- Call `/engage`.
- Show the launcher.
- Render a popup.
- Open chat.
- Potentially call the LLM through the backend `/engage` path.

That violated Sprint 4.1 because Sprint 4.1 must be perception-only shadow mode. Semantic events may be collected and backend perception may run, but nothing should reach the visitor.

### Change Made

A new widget config flag was added:

```ts
legacyEngagement: boolean;
```

It is read from the script tag as:

```html
<script
  src="https://host/widget.js"
  data-site-id="demo"
  data-backend="https://api.host"
  data-debug="true"
  data-legacy-engagement="false">
</script>
```

The default is `false`.

### Files Changed

#### `widget/src/types.ts`

Added `legacyEngagement` to `WidgetConfig`.

Reason:

- Makes legacy engagement explicit and opt-in.
- Prevents accidental visitor-facing UI during Sprint 4.1.

#### `widget/src/config/index.ts`

Added parsing for:

```ts
data-legacy-engagement="true"
```

Reason:

- Keeps the legacy path available behind configuration.
- Avoids deleting code or changing the architecture.

#### `widget/src/core/orchestrator.ts`

Changed orchestration so that the default path only starts sensors:

```ts
this.startSensors();
```

The legacy path is now gated behind:

```ts
if (this.cfg.legacyEngagement) {
  this.startLegacyEngagement();
}
```

The following are only created or executed when `legacyEngagement` is explicitly enabled:

- `createWidgetRoot()`
- `ApiClient`
- `SessionManager`
- `Tracker`
- `ChatWindow`
- `tracker.start()`
- `showLauncher()`
- `/engage`
- `showPopup()`

Reason:

- In default Sprint 4.1 mode, the widget collects semantic events only.
- No launcher, popup, chat, root UI, or `/engage` call can happen accidentally.
- The legacy path remains isolated for pre-4.1 compatibility work.

## Issue 2: `/events` Returned HTTP 400 For Malformed Envelopes

### Problem

The `/events` route used the shared `validateBody(eventsRequestSchema)` middleware. Invalid request envelopes returned HTTP 400.

Sprint 4.1 documentation describes `/events` as a resilient shadow-mode endpoint that should never break the widget or affect the visitor.

### Decision

Option B was chosen: keep the documentation and modify the endpoint to match the documented contract.

Reason:

- `/events` is not a user-facing product action.
- It is a passive perception ingest endpoint.
- Malformed perception input should be ignored, not allowed to break the widget.
- Debug mode can still expose why the request was ignored.

### Files Changed

#### `backend/src/routes/events.ts`

Removed route-level `validateBody(eventsRequestSchema)` usage for `/events`.

The route now calls:

```ts
eventsRequestSchema.safeParse(req.body)
```

If parsing fails, it returns HTTP 200 with:

```json
{ "status": "ignored" }
```

In debug mode, it also includes envelope validation reasons.

The route also catches unexpected ingest errors and returns:

```json
{ "status": "ignored" }
```

Reason:

- Matches the Sprint 4.1 resilient shadow-ingest contract.
- Ensures malformed perception envelopes do not surface as visitor-impacting failures.

#### `backend/src/middleware/errorHandler.ts`

Added an `/events`-specific fallback for request errors such as malformed JSON.

If Express JSON parsing fails on `/events`, the backend now returns:

```json
{ "status": "ignored" }
```

with HTTP 200.

Reason:

- Malformed JSON is rejected before the `/events` route handler runs.
- This keeps the entire `/events` contract resilient, including parse failures.

## Generated File

#### `backend/public/widget.js`

The widget bundle was rebuilt after the widget source changes.

Reason:

- Ensures the deployed widget bundle reflects the new default shadow-only behavior.

## Verification Performed

The following commands were run:

```bash
cd backend
npm test
npm run typecheck

cd ../widget
npm run typecheck
npm run build
```

### Results

- Backend tests: passed, `18/18`.
- Backend typecheck: passed.
- Widget typecheck: passed.
- Widget build: passed.

Note:

- `npm test` and `npm run build` initially failed inside the Windows sandbox with `spawn EPERM`.
- Both were rerun outside the sandbox with approval and passed.

## Final Sprint 4.1 State

Sprint 4.1 now behaves as required:

- Semantic sensors run in the widget.
- Semantic events are posted to `/events`.
- Backend perception runs in shadow mode.
- Behaviour Engine runs.
- Intent Engine runs.
- Confidence Engine runs.
- Sales Brain can make a shadow decision.
- Shadow decisions are logged/debuggable.
- No default widget UI is created.
- `/engage` is not called by default.
- No popup is shown by default.
- No chat is opened by default.
- No LLM call can happen through the default Sprint 4.1 widget path.
- Malformed `/events` requests are safely ignored with HTTP 200.

## Final Freeze Answer

Can Sprint 4.1 now be officially frozen?

YES
---

# Sprint 4.2 Component 6 Walkthrough: Response Validation

## Purpose

This checkpoint implements only the Sprint 4.2 Response Validation layer. It does not generate or show a popup, does not call the LLM, and does not modify Sprint 4.1.

The layer validates raw popup language from the provider-independent LLM adapter before any visitor-facing rendering can exist.

## Files Changed

### `backend/src/intelligence/responseValidation.ts`

Added a new response validation module.

What it does:

- Accepts the raw `PopupLlmResult` from the LLM adapter.
- Returns either trusted `ValidatedPopupLanguage` or a fail-closed fallback.
- Rejects malformed output.
- Rejects legacy decision-shaped output such as `showPopup` or `confidence`.
- Enforces title, body, CTA, tone, and popup type schema constraints.
- Enforces strategy alignment.
- Enforces CTA intent alignment.
- Rejects discount language when business policy forbids discounts.
- Rejects invented pricing amounts.
- Rejects invented guarantees.
- Rejects specific unsupported claims such as SOC 2, HIPAA, GDPR, awards, customer counts, 24/7 claims, and case-study claims when not present in retrieved knowledge.
- Sanitizes visitor-facing strings by stripping control characters and angle brackets.

Why it was necessary:

- Sprint 4.2 requires every generated response to be validated before popup generation.
- The LLM adapter intentionally returns untrusted output.
- This module creates the deterministic safety boundary between raw language generation and future popup rendering.

### `backend/src/intelligence/index.ts`

Exported the response validation API from the intelligence barrel.

Why it was necessary:

- Keeps Sprint 4.2 components available through the existing intelligence-layer public boundary.

### `backend/src/intelligence/__tests__/responseValidation.test.ts`

Added focused automated tests for the response validation layer.

Covered cases:

- Approves grounded popup language matching the approved strategy.
- Fails closed when the LLM adapter failed.
- Rejects malformed or legacy decision-shaped responses.
- Rejects strategy and popup type drift.
- Rejects CTA text that ignores the approved CTA intent.
- Rejects invented pricing amounts.
- Rejects invented guarantees.
- Rejects unsupported claims not present in retrieved knowledge.
- Rejects discount language when `avoidDiscounts` is enabled.
- Allows support-style popup language only when the strategy and CTA are support-aligned.

## Architecture Mapping

This component maps to the Sprint 4.2 pipeline stage:

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

Only `Response Validation` was implemented in this checkpoint.

## Verification

Commands run:

```bash
cd backend
npm run typecheck
npm test

cd ../widget
npm run typecheck
npm run build
```

Results:

- Backend typecheck: passed.
- Backend tests: passed, `55/55`.
- Widget typecheck: passed.
- Widget build: passed.

Notes:

- `npm test` initially failed inside the Windows sandbox with `spawn EPERM`; rerun outside the sandbox and passed.
- `npm run build` for the widget initially failed inside the Windows sandbox because esbuild could not spawn its service process; rerun outside the sandbox and passed.

## Current Sprint 4.2 State

Completed components so far:

1. Conversation Strategy Layer
2. Knowledge Retrieval
3. Prompt Builder
4. Safety Layer
5. LLM Adapter
6. Response Validation

Next component, after approval, is Popup Generation.

---

# Sprint 4.2 Component 7 Walkthrough: Popup Generation

## Purpose

This checkpoint implements the final Sprint 4.2 backend stage: Popup Generation.

It does not change Sprint 4.1, does not wire popup output into `/events`, and does not modify widget runtime behavior. The new code creates an internal popup artifact only after the deterministic Sprint 4.2 pipeline has succeeded through Response Validation.

## Files Changed

### `backend/src/intelligence/popupGeneration.ts`

Added a backend-only popup artifact generator.

What it does:

- Accepts only `PopupResponseValidationResult` from the Response Validation layer.
- Produces `GeneratedPopup` only when validation is successful.
- Suppresses popup generation when response validation fails.
- Adds non-visitor-facing trace metadata:
  - `source: validated_llm`
  - selected conversation strategy
  - approved CTA intent

Why it was necessary:

- Sprint 4.2 requires popup fields to come from the validated LLM response only after all previous gates succeed.
- This keeps raw LLM output away from visitor-facing rendering.

### `backend/src/intelligence/popupPipeline.ts`

Added a backend-only safe popup pipeline composer.

Pipeline order:

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

What it does:

- Starts only from a `SalesDecision` already produced by Sprint 4.1.
- Builds a conversation strategy only if the Sales Brain chose `speak`.
- Retrieves strategy-scoped knowledge.
- Runs pre-LLM safety validation before prompt/LLM use.
- Builds the structured popup prompt.
- Calls the provider-independent LLM adapter.
- Validates the raw response.
- Generates a popup artifact only after validation succeeds.
- Stops fail-closed at the earliest failed stage.

Why it was necessary:

- Sprint 4.2 must prove the AI can generate a psychologically relevant popup without bypassing the deterministic Sales Brain.
- This gives the backend a safe, testable mouth while keeping visitor-visible behavior unchanged until explicitly wired later.

### `backend/src/intelligence/index.ts`

Exported the new popup generation and popup pipeline APIs.

Why it was necessary:

- Keeps the Sprint 4.2 API available through the existing intelligence-layer barrel.

### `backend/src/intelligence/__tests__/popupGeneration.test.ts`

Added tests for popup generation and safe pipeline composition.

Covered cases:

- Popup artifact is produced only from validated language.
- Failed response validation suppresses popup generation.
- Full safe path returns a validated popup payload.
- Missing knowledge stops before prompt creation and before LLM call.
- Unsupported/invented LLM copy stops at response validation and suppresses popup generation.

## Architecture Mapping

This completes the Sprint 4.2 pipeline:

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

The new `generateSafePopup()` function starts after the Sales Brain decision and composes every Sprint 4.2 layer in order.

## Verification

Commands run:

```bash
cd backend
npm run typecheck
npm test

cd ../widget
npm run typecheck
npm run build
```

Results:

- Backend typecheck: passed.
- Backend tests: passed, `60/60`.
- Widget typecheck: passed.
- Widget build: passed.

Notes:

- `npm test` initially failed inside the Windows sandbox with `spawn EPERM`; rerun outside the sandbox and passed.
- `npm run build` for the widget initially failed inside the Windows sandbox because esbuild could not spawn its service process; rerun outside the sandbox and passed.

## Current Sprint 4.2 State

Completed components:

1. Conversation Strategy Layer
2. Knowledge Retrieval
3. Prompt Builder
4. Safety Layer
5. LLM Adapter
6. Response Validation
7. Popup Generation

Sprint 4.2 now has a complete backend-safe popup generation path. Visitor-visible activation remains intentionally unwired.
