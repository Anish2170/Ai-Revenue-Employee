# Sprint 4.1 — Implementation Walkthrough

> **Milestone:** "Perception loop, end to end" (the thin vertical slice from §11 of the Sprint 4 architecture).
> **Status:** ✅ Complete and verified. Runs in **shadow mode** — the backend perceives and decides on every session, but nothing is enacted and no LLM is called.
> **Date:** 2026-07-04

---

## 1. What Sprint 4.1 set out to do

From the frozen architecture (`SPRINT-4-INTELLIGENCE-ARCHITECTURE.md`, §11):

> Semantic events flow from **widget → server-side session → deterministic Behaviour + Intent + Confidence → a *silent* decision with a full reason trace.** No LLM changes, no new popups yet.

The whole point of this slice is to stand up the **perception spine** and prove it produces sensible decisions **without changing anything the visitor sees**. If the traces look right, the risky part (turning on the mouth) becomes a small, safe follow-up in Sprint 4.2.

The seven non-negotiables it had to honour:

1. Not a chatbot — an AI Sales Employee
2. Proactive engagement is the USP
3. **Raw events never reach the LLM**
4. One unified engine, device only at the edge
5. Psychology over page-rules
6. Know when to stay silent
7. Every decision explainable

---

## 2. The shape of what was built

```
   WIDGET (browser, device-aware edge)
   ┌─────────────────────────────────────────────┐
   │ SensorAdapter  ── DesktopSensors             │
   │                └─ MobileSensors              │  raw DOM → semantic events
   │ zones.ts (zone resolution)                   │
   │ session.ts (anon first-party id)             │
   │ emitter.ts (batch → POST /events)            │
   └───────────────────────┬─────────────────────┘
                            │  low-rate SEMANTIC feed (never raw coords/keystrokes)
                            ▼
   BACKEND (device-blind from here up)
   ┌─────────────────────────────────────────────┐
   │ POST /events                                 │
   │   → eventQuality  (§10.4 validation)         │
   │   → botFilter     (§10.5)                    │
   │   → visitorSession (server-side state)       │
   │   → perceive():                              │
   │        Behaviour Engine → BehaviourState     │
   │        Intent Engine    → IntentRead         │
   │        Confidence       → E·C·S·R scalar     │
   │        Sales Brain      → speak/silent + WHY  │  ← SHADOW: logged, not enacted
   │   → log SalesDecisionTrace                    │
   └─────────────────────────────────────────────┘
```

The LLM (Gemini) is **not** in this path at all. That is deliberate — stage 8 (strategy + message) is Sprint 4.2.

---

## 3. Backend — file by file

All under `backend/src/intelligence/` unless noted.

### 3.1 `types.ts` — the contracts
The single source of truth for every shape that flows through perception:
- `SemanticEvent` — `{ type, zone, intensity, ts, surface }`. The **only** thing the widget sends up. `surface` is metadata, never branched on above the edge.
- Closed enums: `ZONES`, `SEMANTIC_TYPES` (the 8 MVP events), `BEHAVIOUR_LABELS` (8 states), `GOALS` (6).
- `BehaviourState`, `IntentRead`, `ConfidenceResult`, `SalesDecision`, and `SalesDecisionTrace` (the reason trace — debugging surface + A/B unit + trust story + future training signal, all in one object).

### 3.2 `config/` — every tunable constant, isolated
Mirrors the existing `config/policy.ts` philosophy ("tune in one place, no code changes"):
- `behaviourRules.ts` — the evidence table (e.g. `pricing_focus → PriceSensitive +0.5`). **This *is* the behaviour model.**
- `confidence.config.ts` — `k=0.5`, `halfLife=45s`, conflict penalties, band thresholds (high ≥ 0.72, medium ≥ 0.45).
- `salesPolicy.config.ts` — speakScore weights, per-surface `speakThreshold` (mobile bar is higher — one constant, not a second codebase), cooldown, frequency budget.

### 3.3 `behaviourEngine.ts` — *how* is the visitor acting?
Pure function `runBehaviourEngine(events, now) → BehaviourState`:
- Accumulates decayed, intensity-scaled evidence into a **weighted state vector** (states are not mutually exclusive — humans are mixtures).
- **Exponential decay** (45s half-life) so a stale spike can't dominate.
- **Trajectory** (`warming`/`cooling`/`flat`) by sampling the forward-funnel score at suffixes of the stream.
- **Stability** (`settled`/`volatile`) — volatile reads get discounted downstream.

### 3.4 `intentEngine.ts` — *what* do they want, and *how close* are they?
`runIntentEngine(behaviour, returning) → IntentRead`. The key architectural fix lives here: **Goal and Readiness are separate axes.**
- **Goal** (Learn / Compare / EvaluatePrice / BuyBook / GetSupport / Undecided) via a contribution table.
- **Readiness** (`cold`/`warm`/`hot`) derived independently from trajectory + action signals.
- Emits `conflict` + `alternatives` so the Brain can reason about its own doubt.

### 3.5 `confidence.ts` — *how sure* are we?
`computeConfidence(...) → { score, band, inputs }`:
```
confidence = E · C · S · R
  E = 1 − exp(−k·n)      evidence (saturating)
  C = 1 − penalties      consistency (conflict / contradiction)
  S = settled?1:0.6      stability
  R = 0.5^(age/45s)      recency
```
**Multiplicative on purpose** — one pricing glance next to an exit signal collapses, instead of a sum letting strong evidence mask the contradiction.

### 3.6 `salesBrain.ts` — speak or stay silent, and why
`runSalesBrain(...) → SalesDecision`. The heuristic policy that replaced the theoretical EV equation:
```
speakScore =  W_conf·confidence + W_ready·readiness + W_value·goalValue
            − W_fatigue·interruptionFatigue − W_bad·badMomentPenalty

speak ⟺ speakScore ≥ threshold  AND band ≠ low  AND not suppressed
```
- **Suppression gate** (checked first): distracted, recently-dismissed, low-confidence, no-knowledge, frequency budget, cooldown, support-no-sell.
- **Shadow flag** on every trace — this slice always logs, never enacts.

### 3.7 `perceive.ts` — the orchestrator
Ties the four layers into one pure call. This is §7.1 stages 1–7 + the final gate. Stage 8 (LLM) is intentionally absent.

### 3.8 Ingest path
- `ingest/eventQuality.ts` — rejects unknown types/zones, clamps intensity, drops impossible sequences (e.g. `form_stall` before `form_start`).
- `ingest/botFilter.ts` — cheap heuristics: `navigator.webdriver`, bot user-agents, perfectly-periodic cadence, burst traversal. Bots never reach perception (cost guard).
- `session/visitorSession.ts` — **server-side** session store (rolling event window + interruption counters + dismissed/returning). **Closes the Sprint-1 gap** where the widget was trusted to own its own counters.
- `businessObjective.ts` — maps tenant instructions → `goalValue` (minimal; full Business Goal layer is 4.2).

### 3.9 Wiring
- `services/perceptionService.ts` — orchestrates validate → bot-filter → attach → `perceive()` shadow → log.
- `routes/events.ts` — `POST /events`, always a safe `200`, dev-only debug trace. Registered in `server.ts` beside `/engage`.
- `validation/eventSchemas.ts` — zod envelope for the batch.

---

## 4. Widget — file by file

All under `widget/src/sensors/`.

- `types.ts` — widget-side mirror of the semantic contract (bundle stays dependency-free).
- `zones.ts` — resolves a DOM element → semantic zone. Consumes a backend-served `zoneMap` when present, with a keyword heuristic fallback so perception works today.
- `session.ts` — anonymous first-party `sessionId` (sessionStorage) + rotating `returning` token (localStorage). **No fingerprinting, no third-party cookies** (§10.1).
- `base.ts` — device-**independent** plumbing: form lifecycle (`form_start`/`form_stall`, never keystroke content), idle/resume, and turning "attention on a zone" into `content_dwell` / `pricing_focus` / `zone_revisit`.
- `desktop.ts` — pointer profile: hover-dwell → attention, cursor-near-CTA → `cta_proximity`, click → `cta_engage`, cursor-to-tab-bar → `exit_signal`.
- `mobile.ts` — touch profile: IntersectionObserver + scroll-stop → attention, tap → `cta_engage` (incl. tap-to-call/WhatsApp), back-button / scroll-to-top / hide → `exit_signal`.
- `emitter.ts` — buffers events, flushes on a 4s cadence + `pagehide`/`visibilitychange`, drops sub-threshold noise at the edge.
- `index.ts` — `SensorEngine`: picks the surface, wires the emitter to `POST /events` (via `sendBeacon`, fetch-keepalive fallback).

**Integration:** `core/orchestrator.ts` calls `startSensors()` inside its own try/catch. A sensor failure is non-fatal and **cannot break the existing popup/chat** — true shadow mode.

---

## 5. How it was verified

### Automated — `npm test` (backend), 18/18 passing
`node --import tsx --test`. Two suites:

**Perception golden tests** (`__tests__/perception.test.ts`) — the §11.5 acceptance corpus, recorded event sequences → asserted behaviour/intent/confidence/decision:

| # | Scenario | Expected |
|---|---|---|
| 1 | Price-wall (SaaS) | speak · PriceSensitive · EvaluatePrice/warm |
| 2 | Nervous first-timer (dentist) | speak · TrustSeeking |
| 3 | Cart hesitator (e-com) | speak · hot |
| 4 | Toothache urgent (mobile) | speak · hot (mobile bar still cleared) |
| 5 | Exit with real intent (gym) | speak once |
| 6 | **Window-shopper** | **silent** |
| 7 | **Distracted** | **silent** (suppressed) |
| 8 | **Returning support user** | **silent** (never sell) |

Scenarios 6–8 — the *silences* — are the most important: they guard the non-negotiables a chatbot fails. Plus unit checks on the multiplicative confidence collapse, evidence decay, and Goal/Readiness independence.

**Ingest tests** (`__tests__/ingest.test.ts`) — event-quality drops, bot detection (webdriver + periodic cadence + human-jitter passes through), and the shadow ingest service asserting `trace.shadow === true`.

### Manual — end to end in a real browser
- Backend + widget both **typecheck clean**; widget **builds** to `backend/public/widget.js` (32kb).
- Loaded the playground, injected a pricing section, simulated hover-dwell + click.
- Observed the live widget POST batches to `/events` (all `200 OK`), and the server logged the correct shadow decision:

```
[perceive:shadow] session=78b0cc8c action=speak score=0.7031/0.55 suppressed=-
  :: Speak — score 0.7031 ≥ 0.55 (goal collect_lead, value 0.7).
     PriceSensitive (1), goal EvaluatePrice, readiness warm, confidence 0.8262 [high].
```

---

## 6. What is intentionally NOT here (Sprint 4.2+)

- The **LLM strategy + message** stage — no popup is generated yet.
- The full **Business Goal layer** (CTA/tone libraries, vertical presets).
- Enacting decisions (cooldown/frequency are computed but not yet enforced against a live popup).
- Conversation hand-off carrying the reason trace into `/chat` (Sprint 4.3).
- The observer port emitting metrics (Sprint 4.3).

---

## 7. File manifest

**New — backend**
```
backend/src/intelligence/types.ts
backend/src/intelligence/config/behaviourRules.ts
backend/src/intelligence/config/confidence.config.ts
backend/src/intelligence/config/salesPolicy.config.ts
backend/src/intelligence/behaviourEngine.ts
backend/src/intelligence/intentEngine.ts
backend/src/intelligence/confidence.ts
backend/src/intelligence/salesBrain.ts
backend/src/intelligence/perceive.ts
backend/src/intelligence/index.ts
backend/src/intelligence/businessObjective.ts
backend/src/intelligence/ingest/eventQuality.ts
backend/src/intelligence/ingest/botFilter.ts
backend/src/intelligence/session/visitorSession.ts
backend/src/intelligence/__tests__/fixtures.ts
backend/src/intelligence/__tests__/perception.test.ts
backend/src/intelligence/__tests__/ingest.test.ts
backend/src/services/perceptionService.ts
backend/src/routes/events.ts
backend/src/validation/eventSchemas.ts
```

**New — widget**
```
widget/src/sensors/types.ts
widget/src/sensors/zones.ts
widget/src/sensors/session.ts
widget/src/sensors/base.ts
widget/src/sensors/desktop.ts
widget/src/sensors/mobile.ts
widget/src/sensors/emitter.ts
widget/src/sensors/index.ts
```

**Modified**
```
backend/src/server.ts          (register eventsRouter)
backend/package.json           (add "test" script)
widget/src/core/orchestrator.ts (start SensorEngine, isolated)
```

---

## 8. How to run it yourself

```bash
# Backend tests (18/18)
cd backend && npm test

# Typecheck both
cd backend && npm run typecheck
cd widget  && npm run typecheck

# Build the widget → backend/public/widget.js
cd widget && npm run build

# Run the backend, then open the playground
cd backend && npm run dev
#   → http://localhost:8787/playground.html
# Interact with the page; watch the console for [perceive:shadow] lines.
```

---

**Bottom line:** the perception spine is live and correct. The backend now understands visitor psychology on every session — behaviour, intent, readiness, confidence, and a stated reason — and it stays completely silent, exactly as Sprint 4.1 requires. Sprint 4.2 turns on the mouth.
