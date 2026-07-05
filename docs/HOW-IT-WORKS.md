# How It Works — Behaviour, Tracking, Intent & Context

A detailed reference for how the AI Revenue Employee widget observes a visitor and
decides when/how to engage. There are **four distinct systems** that hand off to
each other:

1. **Behaviour** — *what* is captured
2. **Behaviour tracking** — *how* it's captured (the in-browser engine)
3. **Intent detection** — *how* the decision is calculated (two stages)
4. **Context-awareness** — *how* the AI knows the business and the visitor

> The one-line mental model: **code is the cheap, predictable filter around an
> expensive, smart core (the LLM).** Numbers are computed deterministically;
> judgment (intent + the words shown) is the LLM's.

---

## 1. Behaviour — *what* is captured

Everything reduces to one object, the **`VisitorBehaviour` snapshot**
(assembled in `widget/src/tracker/buffer.ts`):

| Field | Meaning | How it's derived |
|---|---|---|
| `page` | Current path | `window.location.pathname` |
| `pageTitle` | Page title | `document.title` |
| `timeOnPage` | Seconds on page | `(now − pageStart) / 1000` |
| `scrollDepth` | Furthest % scrolled | running max of scroll samples |
| `mouseInactive` | Seconds idle | `(now − lastActivity) / 1000` |
| `clickedElements` | What they clicked | stable IDs, deduped, max 20 |
| `formInteracted` | Touched a form? | boolean flag |
| `viewport` | Screen size | `window.innerWidth/Height` |
| `exitIntent` | About to leave? | boolean flag |

This snapshot is the **only** thing sent to the backend — never raw events.

---

## 2. Behaviour tracking — *how* it's captured (the engine)

Tracking happens **in the browser** and is aggregated, not streamed event-by-event.
Three pieces:

### (a) Event listeners — `widget/src/tracker/events.ts`
Each listener feeds the buffer:

- **scroll** → throttled to once / 400ms. Computes depth and records it.
- **mousemove** → throttled to once / 1000ms → resets the idle timer only.
- **click** → resolves the element to a stable ID via `describeElement()`
  (prefers `data-track` → `id` → `aria-label` → tag name).
- **focusin / input** on a field → sets `formInteracted`.
- **keydown** → resets idle timer.
- **mouseout** where the cursor leaves the top edge (`clientY ≤ 0`) → sets `exitIntent`.

### (b) The buffer (event buffering) — `widget/src/tracker/buffer.ts`
High-frequency events (scroll, mousemove) are **folded into aggregates** rather than
stored individually:

- `recordScroll(depth)` → `maxScrollDepth = max(maxScrollDepth, depth)`
- `markActive()` → `lastActivity = now`
- clicks → a bounded, deduped array (max 20)

So 500 mouse-moves become **one** number (idle time), not 500 records. `snapshot()`
assembles the table from §1 on demand.

### (c) Lifecycle + formulas — `widget/src/tracker/state.ts`
- A **5-second tick** (`setInterval`) periodically re-checks state.
- **Scroll depth formula** (per sample, in `events.ts`):
  ```
  depth = min(100, (scrollY / (scrollHeight − innerHeight)) × 100)
  ```
  Short pages with nothing to scroll count as 100% ("fully seen").
- **SPA navigation detection:** monkey-patches `history.pushState` / `replaceState`
  and listens for `popstate`. On a path change it **resets the buffer** and emits a
  `navigation` event so each page starts fresh.

**Key point:** tracking is continuous and in-memory; nothing leaves the browser until
a *milestone* fires an `/engage` call.

---

## 3. Intent detection — *how* it's calculated (TWO stages)

"Intent" is computed in two very different layers.

### Stage 1 — Deterministic engagement score (cheap, in code)
The widget decides *when to ask*; the backend rules engine
(`backend/src/rules/rulesEngine.ts`) decides *whether it's worth the AI*. It checks
five **signals** (thresholds in `backend/src/config/policy.ts`):

| Signal | Condition |
|---|---|
| `dwell` | `timeOnPage ≥ 25s` |
| `deep_scroll` | `scrollDepth ≥ 60%` |
| `click` | any element clicked |
| `form` | form interacted |
| `exit_intent` | exit intent detected |

Then a coarse **engagement score**:
```
score = min(1, signals.length / 5 + 0.2)
```
→ 1 signal = 0.4, 2 = 0.6, 3 = 0.8, 4–5 = 1.0.

This is **not** semantic intent — it's a gate. If **zero** signals → stop, return
`showPopup:false`, **no AI call** (the cost guard). If ≥1 signal → proceed.

It also picks a coarse `ruleMatched` label (`exit_intent_engagement` vs
`engaged_visitor`) for the debug trace.

### Stage 2 — Semantic intent (the LLM)
The *actual* intent label (e.g. `pricing_interest`, `service_research`,
`ready_to_book`) is decided by **Gemini**, not code. It receives:

1. the behaviour snapshot (raw numbers),
2. a plain-English summary of it (see §4b),
3. the deterministic signals + score,
4. the business context.

It returns a structured `intent` + a `confidence` (0–1, the model's own certainty).
That confidence is then re-gated by code: in `finalizeDecision()`, anything below
**`minConfidence = 0.6`** is suppressed back to "no popup."

> **Division of labour:** code decides *if* it's worth asking; the AI decides *what*
> the intent is and *how* to respond; code makes the final go/no-go on confidence.

---

## 4. Context-awareness — *how* the AI "knows" things

Two kinds of context, both injected into the prompt.

### (a) Business context — *what the company is*
`backend/src/context/provider.ts` → `getBusinessContext()` returns the
`BusinessContext`: name, description, services, positioning, pricing, FAQs, contact,
and `siteLinks`. Today it's a static file (`backend/src/context/staticContext.ts`).
The abstraction means Sprint 3–4 can swap in a live crawler/RAG with no other code
changing.

### (b) Visitor context — *what this person is doing*
`backend/src/behaviour/summarizer.ts` deterministically turns the raw numbers into a
sentence the LLM reasons better over. Thresholds:

- **Dwell phrasing:** ≥120s "over two minutes", ≥60s "more than a minute",
  ≥30s "about half a minute", ≥10s "N seconds", else "just arrived".
- **Scroll phrasing:** ≥90% "almost the entire page", ≥60% "most of the page",
  ≥30% "partway", else "barely scrolled".
- **Device:** `viewport.width < 768` → "a mobile device", else "a desktop browser".
- Adds notes for clicks, form interaction, idle time (≥8s "may be reading or
  hesitating"), and exit intent.

Example output:
> *"The visitor has spent more than a minute on the 'Pricing' page (/pricing) and
> scrolled almost the entire page. They clicked: button:Growth. They have not
> interacted with any contact form yet. They are browsing on a desktop browser."*

The prompt builder (`backend/src/prompts/engagePromptBuilder.ts`) stitches business
context + this visitor summary + the rules signals into one prompt → that's what makes
the response "context-aware."

---

## 5. The full pipeline

```
Browser:  listeners → BehaviourBuffer (aggregate) → snapshot() on milestone
                                  │
POST /engage ▼
Backend:  rulesEngine.shouldEvaluate()   → score = min(1, signals/5 + 0.2); 0 signals ⇒ stop (no AI)
          getBusinessContext()           → WHAT the business is
          summarize(behaviour)           → WHAT the visitor is doing (deterministic)
          engagePrompt.build(...)        → business + visitor context fused
          Gemini                         → intent label + confidence + message + cta + ctaUrl
          responseValidator              → sanitize, clamp confidence 0–1, allowlist ctaUrl
          rulesEngine.finalizeDecision() → drop if confidence < 0.6
                                  │
          ▼ {showPopup, intent, confidence, message, cta, ctaUrl, debug?}
Browser:  render popup → CTA navigates (whitelisted url) OR opens chat (seeded)
```

---

## 6. The CTA / button logic (recent behaviour)

- **Most popups open a chat**; a navigation button is the exception, used sparingly.
- The AI may set `ctaUrl` only to an **exact entry** from the site's `siteLinks` list
  — it can never invent a URL (allowlisted server-side in `responseValidator.ts`).
- **Never navigates to the current page.** If the most relevant page is the one the
  visitor is already on, the backend strips `ctaUrl` and the button opens chat with a
  "Discuss …" style label instead.
- When the CTA opens chat, the chat is **seeded** with the popup's message as the
  first assistant turn, so the visitor can reply directly. (Gemini requires history to
  start with a user turn, so a leading seeded message is lifted out and passed as
  prompt context — see `backend/src/services/chatService.ts`.)
- Client-side guard also blocks unsafe schemes (`javascript:`/`data:`) in
  `widget/src/core/orchestrator.ts`.

---

## 7. Tuning reference — where the numbers live

| What | Where | Default |
|---|---|---|
| Dwell threshold | `backend/src/config/policy.ts` → `eligibility.minTimeOnPage` | 25s |
| Scroll threshold | `policy.ts` → `eligibility.minScrollDepth` | 60% |
| Confidence floor | `policy.ts` → `minConfidence` | 0.6 |
| Cooldown between evals | `policy.ts` → `cooldownSeconds` | 25s |
| Max evals per session | `policy.ts` → `maxEngagePerSession` | 6 |
| Widget dwell milestone | `widget/src/tracker/state.ts` → `DWELL_MILESTONE_SECONDS` | 25s |
| Widget tick interval | `widget/src/tracker/state.ts` → `TICK_MS` | 5000ms |
| Widget cooldown | `widget/src/core/orchestrator.ts` → `COOLDOWN_MS` | 25000ms |
| Popup message length cap | `backend/src/validation/engageSchema.ts` → `MAX_MESSAGE_LENGTH` | 320 |
| Business facts / FAQs / links | `backend/src/context/staticContext.ts` | (your data) |
| Prompt wording / version | `backend/src/prompts/engagePromptBuilder.ts` | `engage-v4` |

---

## 8. File map (the pieces referenced above)

```
widget/src/
  tracker/
    events.ts        # DOM listeners; scroll-depth formula; milestone emission
    buffer.ts        # event buffering → aggregates → snapshot()
    state.ts         # lifecycle, 5s tick, dwell milestone, SPA navigation reset
  core/orchestrator.ts  # when-to-ask gates, cooldown, popup→chat, CTA navigation
  session/state.ts   # per-visitor counters (cooldown/dedup), sessionStorage
  popup/popup.ts     # renders backend-provided message + CTA (textContent only)
  chat/chat.ts       # streaming chat, typing indicator, seeded opener

backend/src/
  rules/rulesEngine.ts          # pre-LLM gate (signals/score) + post-LLM gate (confidence)
  context/provider.ts           # getBusinessContext() — the business knowledge
  context/staticContext.ts      # the actual business data (Creovix AI)
  behaviour/summarizer.ts       # deterministic numbers → natural-language summary
  prompts/engagePromptBuilder.ts# fuses context + behaviour → engage prompt
  prompts/chatPromptBuilder.ts  # chat prompt (+ seeded opener handling)
  validation/responseValidator.ts # sanitize, clamp confidence, allowlist ctaUrl
  validation/engageSchema.ts    # single source of truth for the decision shape
  llm/                          # provider-agnostic port + Gemini adapter
  services/engageService.ts     # orchestrates the /engage pipeline
  services/chatService.ts       # builds + streams the chat reply
  config/policy.ts              # all tunable thresholds
```
