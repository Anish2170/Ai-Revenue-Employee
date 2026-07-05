# Sprint 4 Final Production Integration Walkthrough

## Purpose

Sprint 4.2 backend was already complete and manually verified, but the production widget was still not connected to the real popup pipeline.

This walkthrough documents the final Sprint 4 integration work that connects live website visitor behaviour to the validated Sprint 4.2 popup artifact.

The goal was:

```text
Semantic Events
-> /events
-> Perception
-> Behaviour Engine
-> Intent Engine
-> Sales Brain
-> Conversation Strategy
-> Knowledge Retrieval
-> Prompt Builder
-> Safety
-> LLM
-> Response Validation
-> Popup Generation
-> Widget receives popup artifact
-> Visitor sees popup
-> CTA opens existing chat with popup context
```

No Sprint 5 features were added.
No architecture redesign was performed.
Chat, RAG, tenant isolation, source attribution, dashboard, and widget installation were left intact.

## Summary Of Changes

The production integration now works through the existing `/events` semantic event pipeline.

Previously:

- The widget sent semantic events to `/events`.
- The backend ran perception and Sales Brain logic.
- The popup pipeline was only visible through developer playground/debug flow.
- Production widget never consumed popup decisions from `/events`.

Now:

- `/events` can return a validated popup artifact when Sales Brain chooses `speak`.
- The widget reads the `/events` response from normal semantic-event batches.
- The widget renders the generated popup artifact.
- The CTA opens the existing chat and seeds it with popup context.
- Suppression rules are enforced on both backend and widget sides.

## Files Changed

### Backend

#### `backend/src/routes/events.ts`

Added the production bridge between perception and popup generation.

Key changes:

- Resolves tenant from `siteId`.
- Uses the resolved tenant `websiteId` for RAG retrieval.
- Runs `ingestEvents()` to produce the deterministic Sales Brain decision.
- Checks client-side suppression state before calling the LLM pipeline.
- Runs `generateSafePopup()` only when Sales Brain says `speak`.
- Returns a minimal production-safe popup artifact:

```json
{
  "popup": {
    "title": "...",
    "body": "...",
    "cta": "...",
    "tone": "...",
    "popupType": "..."
  }
}
```

- Keeps full debug traces development-only.
- Records server-side interruption state after a popup is generated.
- Adds development logs:
  - `popup_requested`
  - `popup_generated`
  - `popup_suppressed`

#### `backend/src/services/perceptionService.ts`

Updated perception output so `/events` can use the Sales Brain decision in production, not only when debug trace is enabled.

Key changes:

- `IngestResult` now exposes the deterministic decision and objective to the route.
- Added `decisionTs` so the route can record interruption timing.
- Accepts client dismissed state and marks the server-side session dismissed.
- Still does not call the LLM or render UI directly.

#### `backend/src/validation/eventSchemas.ts`

Extended the `/events` envelope with optional client UI state.

Added `clientState` fields:

- `popupShown`
- `lastPopupAt`
- `dismissed`
- `chatOpen`
- `popupActive`
- `popupCount`

This lets the backend preserve production suppression rules without polling or adding a new endpoint.

### Widget

#### `widget/src/sensors/index.ts`

Changed the semantic event transport from fire-and-forget-only to response-aware `fetch`.

Key changes:

- Sends existing semantic event batches to `/events`.
- Includes current widget UI state in `clientState`.
- Reads `/events` JSON response.
- If a valid popup artifact is returned, forwards it to the orchestrator.
- No aggressive polling was added.

#### `widget/src/core/orchestrator.ts`

Connected backend popup artifacts to the real widget UI.

Key changes:

- Initializes session state even when legacy engagement is disabled.
- Provides client suppression state to the sensor engine.
- Converts a backend popup artifact into the existing popup renderer format.
- Ensures one popup only.
- Prevents popup while chat is open.
- Prevents popup if dismissed, already shown, cooldown active, or frequency cap reached.
- On CTA click:
  - logs `popup_clicked` in debug mode
  - closes popup
  - opens existing chat
  - seeds chat with popup body as context

Widget debug logs added:

- `popup_displayed`
- `popup_dismissed`
- `popup_clicked`
- `popup_suppressed`

#### `widget/src/popup/popup.ts`

Updated the popup renderer to support the generated Sprint 4.2 artifact.

Supported fields:

- `title`
- `body`
- `cta`
- `popupType`
- `tone`

The renderer still uses `textContent` for visitor-facing copy and does not hardcode business text.

#### `widget/src/types.ts`

Added widget-side contracts:

- `PopupArtifact`
- `EventsClientState`
- `EventsResponse`

Extended `EngageDecision` compatibility fields so the existing popup renderer can support both legacy and Sprint 4 popup inputs.

#### `widget/src/ui/styles.ts`

Added popup title styling for the generated artifact title.

## Suppression Rules Preserved

The integration respects existing suppression rules.

A popup is not shown when:

- Sales Brain says `silent`
- confidence is low
- the decision is suppressed by Sales Brain
- visitor dismissed the popup
- popup already shown on the page
- cooldown is active
- frequency cap is reached
- chat is already open
- another popup is already active
- popup pipeline fails closed
- LLM/provider fails
- response validation rejects the generated copy
- tenant is unavailable
- RAG knowledge is unavailable

## Production Safety Notes

The widget does not decide whether to interrupt.

The widget only:

1. Sends semantic events.
2. Sends current UI suppression state.
3. Renders a backend-provided popup artifact if one is returned.

The backend still owns:

- Behaviour interpretation
- Intent interpretation
- Confidence
- Sales Brain decision
- Conversation strategy
- Knowledge retrieval
- Safety validation
- LLM call
- Response validation
- Popup artifact generation

The LLM still never decides whether to interrupt.

## Verification Performed

### Automated Checks

Passed:

```bash
cd backend
npm run typecheck
npm test

cd ../widget
npm run typecheck
npm run build
```

Results:

- Backend typecheck passed.
- Widget typecheck passed.
- Widget build passed.
- Backend tests passed: `64/64`.

### Live `/events` Verification

A pricing-focused semantic event batch was posted to `/events`.

Result:

- Sales Brain action: `speak`
- Backend ran popup pipeline
- `/events` returned a validated popup artifact

Example returned artifact:

```json
{
  "title": "Have questions about pricing?",
  "body": "We're happy to discuss our pricing structure and help you find a solution that fits your budget and goals.",
  "cta": "Discuss Pricing",
  "tone": "reassuring",
  "popupType": "pricing"
}
```

### Chat Open Suppression

A strong pricing signal was sent with:

```json
{
  "chatOpen": true
}
```

Result:

- Sales Brain still detected a speak-worthy moment.
- No popup artifact was returned.
- Suppression reason logged as `chat_open`.

### Cooldown Suppression

A strong pricing signal was sent with recent `lastPopupAt` client state.

Result:

- Sales Brain still detected a speak-worthy moment.
- No popup artifact was returned.
- Popup was suppressed due to cooldown.

### Fail-Closed Behaviour

During one live verification, the LLM/provider stage returned a provider failure.

Result:

- No popup was generated.
- No fake/fallback popup was shown.
- Backend logged `popup_suppressed` with reason `provider_error`.

This confirms the pipeline fails closed.

## Manual Verification Checklist

Before locking Sprint 4 in production, manually verify on a real installed website.

### 1. Pricing Popup

Goal: Confirm pricing behaviour can trigger a pricing popup.

Steps:

1. Open a real website with the widget installed.
2. Visit pricing or pricing-like sections.
3. Dwell, revisit, and interact naturally.
4. Watch Network for `POST /events`.

Expected result:

- `/events` eventually returns a `popup` artifact.
- Popup appears on the page.
- Popup type should be pricing or price-anxiety related.

Failure looks like:

- `/events` returns popup but widget does not render it.
- Popup text is hardcoded or unrelated.
- Popup appears without Sales Brain speak decision.

### 2. FAQ / Education Popup

Goal: Confirm educational behaviour can trigger an educational popup.

Steps:

1. Visit FAQ or educational content.
2. Dwell and revisit content sections.
3. Wait for semantic event batch flush.

Expected result:

- Backend may generate an education/helpful popup if confidence is high enough.
- Popup content comes from generated artifact.

Failure looks like:

- Generic or fake popup text appears.
- Popup appears despite low confidence.

### 3. Blog Popup

Goal: Confirm blog/content behaviour can trigger an educational popup.

Steps:

1. Visit a blog article.
2. Scroll and dwell on content.
3. Revisit relevant content zones if possible.

Expected result:

- Popup may appear if deterministic pipeline decides to speak.
- Popup should be educational/helpful, not hardcoded.

Failure looks like:

- Popup appears too aggressively.
- Popup does not match the retrieved knowledge/context.

### 4. Low Confidence Silent Session

Goal: Confirm low-confidence sessions stay silent.

Steps:

1. Open a page.
2. Do very little interaction.
3. Avoid meaningful dwell, pricing focus, CTA proximity, or revisits.

Expected result:

- `/events` returns `ack` only.
- No popup appears.

Failure looks like:

- Popup appears from weak/noisy behaviour.

### 5. Chat Open Prevents Popup

Goal: Confirm the widget never interrupts active chat.

Steps:

1. Open the chat manually.
2. Interact with the page enough to create strong semantic events.
3. Watch `/events` responses.

Expected result:

- No popup appears while chat is open.
- Backend/widget logs may show `chat_open` suppression in debug mode.

Failure looks like:

- Popup appears over an active chat.

### 6. Cooldown Works

Goal: Confirm popup cooldown is respected.

Steps:

1. Trigger a popup.
2. Close it or click CTA.
3. Immediately continue high-intent behaviour.

Expected result:

- No second popup appears during cooldown.

Failure looks like:

- Multiple popups appear in quick succession.

### 7. One Popup Only

Goal: Confirm popups never stack.

Steps:

1. Trigger a popup.
2. Leave it open.
3. Continue interacting with the page.

Expected result:

- No second popup appears while first popup is active.

Failure looks like:

- Multiple popup cards stack.

### 8. CTA Opens Existing Chat

Goal: Confirm popup CTA opens chat with context.

Steps:

1. Trigger a popup.
2. Click CTA.

Expected result:

- Popup closes.
- Existing chat opens.
- Chat is seeded with popup context.
- User can continue conversation normally.

Failure looks like:

- CTA does nothing.
- CTA opens wrong UI.
- Chat opens without context.
- Chat/RAG/source attribution breaks.

### 9. Mobile Verification

Goal: Confirm same backend logic works on mobile.

Steps:

1. Open the real website in mobile emulation or on a mobile device.
2. Trigger meaningful behaviour.
3. Watch `/events`.

Expected result:

- Same `/events` pipeline is used.
- No separate popup logic exists.
- Popup renders responsively.

Failure looks like:

- Mobile uses a separate/legacy popup path.
- Popup layout breaks.

### 10. Desktop Verification

Goal: Confirm desktop sensors and popup render correctly.

Steps:

1. Open the real website on desktop.
2. Trigger pricing/FAQ/blog behaviour.

Expected result:

- `/events` returns validated popup only when appropriate.
- Popup appears cleanly.
- Launcher/chat still work.

Failure looks like:

- Widget loads but popup never renders after backend returns artifact.

## Important Non-Changes

This integration did not modify:

- Chat pipeline logic
- RAG retrieval logic
- Tenant isolation logic
- Source attribution logic
- Dashboard UI
- Widget install snippet
- Sprint 5 features

## Final Result

The real production widget is now connected to the Sprint 4.2 backend popup pipeline.

The production widget can automatically display generated, validated popup artifacts on live websites when the deterministic backend pipeline decides to interrupt.