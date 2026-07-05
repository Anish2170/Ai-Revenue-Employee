# Sprint 4.1 QA Verification

> Role: Senior Staff Engineer and QA Lead  
> Scope: Sprint 4.1 perception layer implementation verification  
> Verdict: **NO - not approved for Sprint 4.2 yet**

## QA Verdict

I would not approve Sprint 4.1 yet.

The new perception pipeline itself is substantially implemented and the backend automated suite passes: `18/18` tests. Backend and widget typechecks pass, and the widget build succeeds to `backend/public/widget.js`.

However, there are two approval blockers against the stated Sprint 4.1 rules.

## Blockers

### 1. The deployed widget is not fully shadow-only

`widget/src/core/orchestrator.ts` still starts the old tracker, shows the launcher, calls `/engage`, and can render a popup:

- `tracker.start()`
- `showLauncher()`
- `api.postEngage(...)`
- `showPopup(...)`

That means popup/LLM behavior can still happen if the old engagement path is configured. The new `/events` path is shadow-only, but the overall visitor experience is not guaranteed silent.

### 2. `/events` is not truly "always safe 200" for malformed envelopes

The route uses `validateBody(eventsRequestSchema)` in `backend/src/routes/events.ts`.

Invalid request bodies return `400` in `backend/src/middleware/validate.ts`.

Valid envelopes with bad semantic events are handled safely, but malformed envelopes are not acknowledged as `200`.

## What Is Verified

- Semantic contracts exist on backend and widget.
- `/events` validates, cleans, bot-filters, stores server-side session events, runs `perceive()`, and logs `[perceive:shadow]`.
- Behaviour, intent, confidence, and Sales Brain are deterministic.
- Debug traces expose behaviour, intent, confidence, policy score, suppression, action, and `shadow: true`.
- Widget sensors emit reduced semantic events only, not raw coordinates or keystrokes.
- Backend tests passed: `npm test`.
- Backend typecheck passed: `npm run typecheck`.
- Widget typecheck passed: `npm run typecheck`.
- Widget build passed: `npm run build`.

## Manual QA Checklist

### 1. Semantic Event Generation

**Goal:** Confirm browser actions become semantic events only.

**Steps:**

1. Run the backend.
2. Open the playground with widget debug enabled.
3. Interact with pricing sections, CTA buttons, forms, and idle states.
4. Inspect `/events` payloads in browser Network tools.

**Expected Result:**

Events contain only:

- `type`
- `zone`
- `intensity`
- `ts`
- `surface`

**Failure Looks Like:**

- Mouse coordinates appear in the payload.
- Scroll positions appear in the payload.
- Keystroke contents appear in the payload.
- DOM text or raw element content appears in the payload.

### 2. Desktop Sensor Behavior

**Goal:** Verify desktop hover, CTA proximity, click, and exit intent behavior.

**Steps:**

1. Open the playground in a desktop viewport.
2. Hover over a pricing section long enough to trigger dwell.
3. Move the cursor near a CTA without clicking.
4. Click a CTA.
5. Move the cursor toward the top edge of the viewport.

**Expected Result:**

The widget emits appropriate semantic events, such as:

- `content_dwell`
- `pricing_focus`
- `cta_proximity`
- `cta_engage`
- `exit_signal`

**Failure Looks Like:**

- No semantic events are emitted.
- Events are emitted with the wrong zone.
- Raw pointer data is sent.
- Event volume is excessively noisy.

### 3. Mobile Sensor Behavior

**Goal:** Verify mobile-specific edge behavior.

**Steps:**

1. Open the playground in mobile emulation or on a real mobile device.
2. Scroll and stop on pricing or product sections.
3. Tap CTA, `tel:`, or WhatsApp links.
4. Trigger tab hide, back navigation, or a fast scroll-to-top gesture.

**Expected Result:**

The widget emits mobile-derived semantic events, such as:

- `content_dwell`
- `pricing_focus`
- `zone_revisit`
- `cta_engage`
- `exit_signal`

**Failure Looks Like:**

- Mobile relies on hover-like assumptions.
- Taps do not produce CTA engagement.
- No events are emitted from scroll-stop attention.
- Mobile sends raw touch or scroll details.

### 4. Event Batching

**Goal:** Verify low-rate event batching.

**Steps:**

1. Perform several interactions in quick succession.
2. Watch the browser Network panel.
3. Trigger `pagehide` or set the tab to hidden.

**Expected Result:**

- `/events` POSTs are batched.
- Flush cadence is roughly every 4 seconds.
- Pending events flush on page hide or visibility hidden.

**Failure Looks Like:**

- One request is sent for every raw browser interaction.
- No request is sent after interactions.
- Final events are lost on page close or hide.
- Transport errors visibly affect the page.

### 5. Server Session Updates

**Goal:** Verify server-side session memory across batches.

**Steps:**

1. Send a batch with `form_start`.
2. Send a later batch with the same `sessionId` containing `form_stall`.
3. Inspect the debug response or logs.

**Expected Result:**

The second batch accepts `form_stall` because `form_start` was seen previously in the same server-side session.

**Failure Looks Like:**

- `form_stall` is rejected despite a prior `form_start`.
- Session state resets between batches with the same `sessionId`.
- The widget appears to own counters that should be server-side.

### 6. Behaviour Detection

**Goal:** Verify the Behaviour Engine produces sensible state vectors.

**Steps:**

1. Generate or POST a pricing-heavy sequence:
   - `content_dwell` on `pricing`
   - `pricing_focus`
   - `zone_revisit` on `pricing`
2. Inspect the debug trace.

**Expected Result:**

The trace shows dominant behaviour as `PriceSensitive`, with supporting vector weights.

**Failure Looks Like:**

- Dominant behaviour remains `Browsing`.
- Pricing events map to unrelated states.
- State vector is empty despite accepted events.

### 7. Intent Detection

**Goal:** Verify goal and readiness are separate axes.

**Steps:**

1. Test a shallow product revisit sequence.
2. Test a stronger CTA/form sequence.
3. Compare intent traces.

**Expected Result:**

- Shallow comparison can be `Compare` but not necessarily `hot`.
- CTA/form action can produce `hot` readiness.
- Goal and readiness are not collapsed into one value.

**Failure Looks Like:**

- Every `Compare` intent is automatically hot.
- Every pricing intent is automatically hot.
- Readiness ignores action signals.

### 8. Confidence Calculation

**Goal:** Verify evidence, consistency, stability, and recency affect confidence.

**Steps:**

1. Send a fresh multi-signal event sequence.
2. Compare it with a stale sequence.
3. Compare it with a contradictory or volatile sequence.
4. Inspect `confidence.inputs` and final band.

**Expected Result:**

- Fresh corroborated evidence scores higher.
- Stale events decay.
- Contradictory or volatile reads reduce confidence.
- Low confidence suppresses speaking.

**Failure Looks Like:**

- Stale signals remain high confidence.
- Contradictory signals do not reduce confidence.
- Confidence band does not match the score thresholds.

### 9. Suppression Logic

**Goal:** Verify hard silence rules.

**Steps:**

1. Test an idle/distracted sequence.
2. Test a low-confidence sequence.
3. Test dismissed, cooldown, and frequency-budget contexts using a unit test or dev harness.
4. Inspect `suppressedBy` in the decision trace.

**Expected Result:**

- Distracted sessions are silent with `suppressedBy: distracted`.
- Low confidence sessions are silent with `suppressedBy: low_confidence`.
- Dismissed, cooldown, and frequency-budget contexts force silence.

**Failure Looks Like:**

- Sales Brain returns `speak` despite hard suppression.
- `suppressedBy` is missing when a hard rule caused silence.
- Cooldown/frequency behavior cannot be verified at all.

### 10. Shadow Decision Logging

**Goal:** Verify perception decisions are logged but not enacted.

**Steps:**

1. Trigger a high-intent sequence that should produce `action: speak`.
2. Watch backend logs for `[perceive:shadow]`.
3. Inspect the `/events` response.
4. Confirm the visitor sees no UI caused by `/events`.

**Expected Result:**

- Backend logs a shadow decision.
- Trace includes `shadow: true`.
- Response is an acknowledgement/debug trace only.
- No popup or LLM message is produced by `/events`.

**Failure Looks Like:**

- `/events` response instructs the widget to show UI.
- `/events` triggers an LLM call.
- A popup appears as a direct result of the new perception path.

### 11. Bot Filtering

**Goal:** Verify bots never reach perception.

**Steps:**

1. Send a request with `botSignal.webdriver: true`.
2. Send a request with a bot-like user agent.
3. Send a perfectly periodic event cadence.
4. Send a human-jitter cadence as a control.

**Expected Result:**

- Clear bot sessions return `status: bot`.
- Bot sessions are flagged and short-circuit future perception.
- Human-like jitter is not falsely classified as bot.

**Failure Looks Like:**

- Bots produce normal shadow decisions.
- Bot status is not remembered for the session.
- Human-like event cadence is incorrectly blocked.

### 12. Event Validation

**Goal:** Verify invalid semantic events are dropped safely.

**Steps:**

1. Send unknown event types.
2. Send unknown zones.
3. Send bad timestamps.
4. Send intensity values outside `0..1`.
5. Send impossible sequences such as `form_stall` before `form_start`.

**Expected Result:**

- Invalid events are dropped.
- Intensity is clamped.
- Drop reasons appear in debug mode.
- Valid events in the same batch can still be accepted.

**Failure Looks Like:**

- Invalid events influence perception.
- Bad timestamps are accepted.
- Impossible sequences are accepted.
- The whole endpoint crashes.

## Automated Testing Required

These should be covered by automated tests:

- Behaviour Engine golden scenarios.
- Intent Engine goal/readiness separation.
- Confidence math and confidence band thresholds.
- Sales Brain scoring and suppression gates.
- Event-quality validation.
- Bot filtering.
- Server-side session accumulation across batches.
- HTTP `/events` contract, including invalid envelope behavior.
- Shadow trace guarantee: `trace.shadow === true`.
- Guarantee that `/events` does not call the LLM.

## Manual Testing Required

These require real browser or browser-automation verification:

- Desktop hover dwell and CTA proximity.
- Desktop exit-intent signal.
- Mobile scroll-stop attention.
- Mobile CTA/tel/WhatsApp tap behavior.
- Pagehide and visibilitychange flushing.
- Network payload inspection for privacy.
- Confirmation that no visitor-facing UI appears from `/events`.

## Areas Difficult To Verify Manually

### Cooldown, Frequency Budget, and Dismissed Suppression

These are difficult to verify manually in Sprint 4.1 because no real interruption is enacted by the shadow perception path.

Verification approach:

- Add focused unit tests that pass `PerceptionContext` directly into `perceive()`.
- Use a temporary dev harness that can set:
  - `priorInterruptions`
  - `lastInterruptionTs`
  - `dismissed`
  - `returning`

### Server-Side Session State

Manual verification is possible but awkward because the session store is internal.

Verification approach:

- Use debug responses from `/events`.
- Add a dev-only inspection endpoint for a given `sessionId`.
- Add tests that submit multiple batches with the same `sessionId`.

### Bot Session Memory

Manual verification is possible but needs repeated requests with the same `sessionId`.

Verification approach:

- Send one bot-classified batch.
- Send a later normal-looking batch with the same `sessionId`.
- Confirm the second request still short-circuits as bot.

## Minimum Debug Tool Before Sprint 4.2

Add a dev-only perception inspector.

Recommended option:

`GET /debug/perception/:sessionId`

It should show:

- Accepted semantic events.
- Dropped event reasons.
- Bot status.
- Returning flag.
- Behaviour state.
- Intent read.
- Confidence result.
- Suppression reason.
- Last shadow Sales Brain decision.
- `shadow: true`.

This should be a lightweight developer tool only. It should not be a production feature, should not show to visitors, and should not generate popups or LLM messages.

## Final Approval Answer

Would I approve Sprint 4.1 for moving into Sprint 4.2?

**NO**

Blockers:

1. The active widget can still call `/engage` and show popup/chat UI.
2. `/events` does not always return a safe `200` for malformed envelopes.
