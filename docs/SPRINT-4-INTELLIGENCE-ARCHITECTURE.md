# Sprint 4 — Intelligence Architecture: The AI Sales Brain

> **Status:** Buildable architecture for Sprint 4. This is the engineering blueprint a startup team implements against — not a product thesis. It defines *how the AI thinks* **and** *how we build it this sprint*.
>
> **Thesis (unchanged):** The product is **not a chatbot** with proactive triggers bolted on. It is an **AI Sales Employee** — a perception-first sales mind that models the visitor's psychological state, decides whether it has earned the right to speak, and only then speaks. The chat is the *last* thing that happens, not the first.
>
> **North-star metric:** *Assisted conversion lift per 1,000 sessions*, subject to a hard ceiling on *interruption regret rate* (visitors who dismiss/ignore and disengage after we spoke). We increase conversions **without** becoming the annoying popup we replace.
>
> **What changed from the previous draft:** the vision is identical; the *mechanics* are now concrete. The theoretical Expected-Value equation is replaced by a **transparent, tunable heuristic policy** (with a documented path to a learned model). Behaviour states, intents, and decision layers are trimmed to the **minimum viable set**. Confidence is now a defined arithmetic, not a placeholder. Every layer has one responsibility and a real integration point in the existing Sprint 1–3 codebase.

---

## 0. Design philosophy — the seven non-negotiables

These principles are the product. Everything below serves them and nothing below is allowed to violate them.

1. **Not a chatbot — an AI Sales Employee.** It perceives before it speaks.
2. **Proactive engagement is the USP.** The reactive chat launcher already works; Sprint 4 is about *knowing when to reach out first*.
3. **Raw events never reach the LLM.** The LLM reasons over compact behavioural/intent summaries, never over `scroll_depth: 0.82`.
4. **One unified intelligence engine** powers desktop and mobile. Device lives only at the sensor edge.
5. **Understand visitor psychology, not page rules.** We infer mental state; we do not fire on timers and URLs.
6. **Know when to stay silent.** Silence is the default and a feature, not a failure.
7. **Every decision is explainable.** The engine states, in one sentence, why it spoke or stayed quiet.

The core mental model — a **three-layer perception stack** modelled on a good showroom salesperson:

```
   SIGNAL              →      UNDERSTANDING           →      DECISION
(what the body              (what the mind is                (approach now?
 is doing)                   probably doing)                  say what?)

 semantic events   →   Behaviour   →   Intent   →   Sales Brain   →   Action
                        Engine         Engine        (policy)         (speak / silent)
```

A human salesperson never thinks "aisle 3 for 90 seconds." They think "keeps picking up the same jacket, checking the price tag, glancing around — wants it, but the price is a wall." The engine must produce *that sentence internally* before it opens its mouth.

> **How to read this doc:** §1–§8 are the engine layers, top to bottom. §9 is extensibility. §10 is safety. §11 is the roadmap (Sprint 4.1 → 4.3). §12 is launch metrics. §13–§16 are the required decision log, kept items, postponed items, and the implementation checklist.

---

## 1. Clean separation of concepts (read this before anything else)

The previous draft let five ideas bleed into each other. Sprint 4 keeps them **strictly separate**, each with **one owner layer** and **one responsibility**. If you find logic for two of these in one module, it is a bug.

| Concept | Question it answers | Owned by | Data type | Never contains |
|---|---|---|---|---|
| **Behaviour** | *How* is the visitor acting? | Behaviour Engine (§4) | weighted state vector | goals, business logic, copy |
| **Intent** | *What* are they trying to do? | Intent Engine (§5) | one goal label + alternatives | readiness, thresholds |
| **Readiness** | *How close* to acting are they? | Intent Engine (§5) | ordinal: `cold / warm / hot` | which goal, which message |
| **Confidence** | *How sure* are we of the above? | Confidence system (§6) | scalar 0..1 | the decision itself |
| **Business Goal** | What is *this client* paying us to achieve? | Business Goal Layer (§8) | tenant config | per-visitor state |
| **Decision** | Speak or stay silent, and how? | Sales Brain (§7) | Decision + reason trace | raw events, sensor detail |

**The critical split the previous draft missed:** *Intent* (the visitor's goal, e.g. "Compare Plans") and *Readiness* (how close to buying, e.g. "hot") are **different axes** and must be stored separately. A visitor can have a crystal-clear goal (Compare Plans) but be cold (early research), or a fuzzy goal but be hot (ready to buy *something*, unsure what). Collapsing them was the biggest source of over-confident popups.

```
   Goal axis:        Learn ─ Compare ─ Evaluate Price ─ Buy/Book ─ Support
   Readiness axis:   cold ───────── warm ───────── hot
                     (independent — a visitor has one value on each)
```

---

## 2. Layer responsibilities at a glance

```
┌──────────────────────────────────────────────────────────────────────┐
│ WIDGET (edge)        Sensors → semantic Events. The ONLY device-aware  │
│                      layer. Stays dumb: no goals, no thresholds, no copy│
├──────────────────────────────────────────────────────────────────────┤
│ BACKEND (device-blind from here up)                                    │
│  3. Event Ingest     validate, bot-filter, session-attach              │
│  4. Behaviour Engine  events → weighted behaviour state vector          │
│  5. Intent Engine     states → { goal, readiness, alternatives }        │
│  6. Confidence        one scalar over the above                         │
│  7. Sales Brain       heuristic POLICY → speak/silent + reason          │
│      └ LLM (Gemini)   invoked ONLY here, on a compact summary           │
│  8. Business Goal     tenant config: Value weights, CTA library, tone   │
└──────────────────────────────────────────────────────────────────────┘
```

**LLM boundary (hard):** stages 3–6 and the final gate are deterministic code. The LLM is called **once per decision**, only after the policy has *already decided to speak*, to choose the strategy and write the words. This is what keeps it cheap, fast, debuggable, and vendor-swappable behind the existing `LLMProvider` port.

---

## 3. Event Collection & Ingest Layer

The event layer is a **sensor**, not a brain. Three jobs, no more:

1. Capture **behavioural primitives** — the smallest units that carry psychological signal.
2. Normalize them into a **device-independent semantic event schema** (§8 collapses desktop/mobile here).
3. **Refuse to over-collect.** Every event is a liability (privacy, noise, cost, battery).

> **Litmus test for any new event:** "Name a behaviour state or intent whose probability this event moves. If you can't, don't collect it."

### 3.1 The semantic event schema

Every event, from any surface, is emitted as:

```ts
interface SemanticEvent {
  type:      SemanticType;     // "content_dwell" | "zone_revisit" | ... (closed enum)
  zone:      Zone;             // "pricing" | "faq" | "cta" | "trust" | "product" | "contact" | "other"
  intensity: number;          // 0..1 normalized magnitude
  ts:        number;          // monotonic ms since session start
  surface:   "desktop" | "mobile" | "tablet";  // METADATA ONLY — never branched on above §3
}
```

Events are **semantic** ("dwelled on pricing"), not **mechanical** ("mousemove 402,118"). Mechanical capture happens at the very edge and is *immediately* mapped to a semantic zone using the site's own structure — which we already extract during the RAG crawl (Sprint 2 knows which URL/section is pricing, FAQ, contact). This mapping is the seam that makes desktop and mobile collapse into one model (§8).

**Zone resolution (concrete):** the widget receives, at load, a small `zoneMap` from the backend (derived from the crawl): a list of `{ selector | urlPattern, zone }`. The widget tags DOM regions once and emits the zone label, never coordinates.

### 3.2 The MVP event set (Sprint 4.1 ships exactly these 8)

We start with the 8 events that carry ~80% of the signal. Everything else is postponed.

| Semantic event | Captures | Moves which behaviour state |
|---|---|---|
| `content_dwell{zone}` | Genuine attention (visible + focused, ≥ 800ms) | Researching, Trust-Seeking, Price-Sensitive |
| `zone_revisit{zone}` | Returning to a zone already seen | Comparing, Hesitating |
| `pricing_focus` | Attention specifically on price/plans | Price-Sensitive, Evaluating |
| `cta_proximity` | Near a CTA without activating it | Hesitating |
| `cta_engage` | Click/tap on a CTA (incl. tap-to-call) | Ready |
| `form_start` / `form_stall` | Lead/booking form begun, then paused ≥ 8s | Ready, then friction |
| `exit_signal` | Leaving intent (device-derived, §8) | Leaving |
| `idle` / `resume` | Attention lost then regained | Distracted (suppress) |

**Deferred to Sprint 4.2+ (not built in 4.1):** `search_or_filter`, `content_velocity`, `return_visit`, `deep_link_entry`, `repeat_intent_zone`, `text_select`, `rage_click`, `tab_blur`. Each is additive and slots into the same schema — we turn them on once the core loop is proven.

### 3.3 Desktop vs mobile derivation (same events, different raw material)

| Semantic event | Desktop raw material | Mobile raw material |
|---|---|---|
| `content_dwell` | Hover dwell + viewport visibility | Scroll-stop + IntersectionObserver visibility |
| `zone_revisit` | Re-hover / re-scroll to prior zone | Scroll-up reversal to prior zone |
| `cta_proximity` | Cursor near CTA, no click | Repeated approach to CTA zone, no tap |
| `exit_signal` | Cursor velocity toward tab bar | Back-button / scroll-to-top burst / app-switch |
| `cta_engage` | Click | Tap — including **tap-to-call / WhatsApp / map** (first-class on mobile) |

### 3.4 What we deliberately do NOT collect

- **No keystroke content.** `form_start`/`form_stall` only — never what is typed.
- **No raw coordinate streams.** Coordinates are consumed at the edge to derive semantic events, then discarded. Never shipped to the backend.
- **No heatmaps, no fingerprinting, no third-party cookies, no cross-site tracking.** Identity = first-party session id + optional returning-visitor token.
- **No PII before consent.** Email/phone captured only inside an intentional conversation/form.
- **No high-frequency noise.** 60Hz mousemove, micro-scroll jitter, sub-800ms dwell — debounced and dropped at the edge.
- **No vanity events.** Time-on-site, pageviews, bounce are *reporting*, not *psychology*. The brain never consumes them.

### 3.5 Ingest: validate → bot-filter → attach (new backend responsibility)

The widget streams a **low-rate semantic event feed** (batched, ~1 POST / few seconds, not per-event) to a new `POST /events` endpoint. Ingest does three cheap things before the Behaviour Engine ever runs (details in §10.4–10.5):

1. **Schema-validate** each event (reject unknown types/zones, clamp `intensity`, drop out-of-order `ts`).
2. **Bot-filter** (§10.5): drop sessions with non-human cadence.
3. **Attach to a server-side session** (the S2 session store) so state persists across the batch stream instead of being trusted from the client.

> This is the point where Sprint 4 finally moves session state **server-side**, closing the Sprint 1 "widget owns the counters" gap noted in `rulesEngine.ts`.

---

## 4. Behaviour Engine

**Single responsibility:** convert the semantic event stream into a small **weighted behaviour state vector**. It answers *how* the visitor is acting — nothing about goals, readiness, or business logic.

### 4.1 Why a dedicated deterministic layer

- **Cost & speed:** pattern-matching over event sequences is instant and free in code. Sending raw events to an LLM every few seconds is slow, costly, non-deterministic — and violates non-negotiable #3.
- **Explainability:** "Comparing" is a human word a dentist understands. `scroll_depth: 0.7` is not.
- **Device convergence:** this is where desktop and mobile become one vocabulary.

### 4.2 The MVP behaviour vocabulary — trimmed from 14 to 8

The previous draft had 14 states with heavy psychological interpretation. For Sprint 4 we keep **8**. Merges: *Window-Shopping* folds into *Browsing*; *Confused* folds into *Hesitating* (both → "stuck, needs help"); *Existing-Customer / Support-Needed / Returning-Consideration* collapse into a single **Returning** flag carried as session metadata, not a live state (they need the S2 return-token, and are only *acted on* by the Business Goal layer). We can re-split later without re-architecting — the vector is open.

| State | Illustrative signal pattern | The human sentence |
|---|---|---|
| **Browsing** | Low dwell, wide shallow coverage, no zone focus | "Just looking / killing time." |
| **Researching** | Deep dwell on features/FAQ, slow read | "Genuinely trying to understand this." |
| **Comparing** | Zone revisits between plans/products | "Weighing you against an alternative." |
| **Price-Sensitive** | Repeated `pricing_focus`, revisit to pricing | "The number is the sticking point." |
| **Trust-Seeking** | Dwell on testimonials, about, guarantees | "Are you legit? Can I trust you?" |
| **Hesitating** | `cta_proximity` without engage; `form_stall`; loops | "Hand hovering, not clicking / stuck." |
| **Ready** | `cta_engage`, `form_start`, deep-link to pricing | "I've decided; reduce my friction." |
| **Distracted** | `idle`/`resume`, incoherent path | "Multitasking; not present — do not interrupt." |

**States are not mutually exclusive.** A visitor can be `Comparing` **and** `Price-Sensitive`. The output is a **weighted vector**, e.g. `{ Comparing: 0.7, Price-Sensitive: 0.6, Hesitating: 0.3 }`. Real humans are mixtures — this is deliberate.

> **Behaviours are probabilistic hypotheses, not facts.** Every weight is "the evidence so far *suggests* this," never "this is true." Downstream layers must treat them as such (the Confidence system, §6, exists precisely for this).

### 4.3 How it computes (deterministic, testable)

1. **Rolling window:** maintain recent events + a session summary per visitor (in the S2 session store).
2. **Template matching:** each state has a small set of **evidence rules**, e.g.
   `Price-Sensitive += w  when  (pricing_focus count ≥ 2)  OR  (zone_revisit{pricing})`.
   Rules live in a single tunable table (`behaviourRules.ts`), mirroring how `policy.ts` centralizes thresholds today.
3. **Evidence accumulation with decay:** each state weight accumulates on matching evidence and **decays exponentially** with time (§6.3). A confusion spike 4 minutes ago must not dominate now.
4. **Trajectory:** track the *direction* of the dominant state over the last few windows. `Researching → Comparing → Hesitating` is a funnel in motion; `Browsing → Browsing → idle` is going nowhere. Trajectory is one of three enums: `warming | cooling | flat`.
5. **Stability:** how volatile is the vector? `settled | volatile`. Volatile vectors are discounted downstream.

**Output contract:**
```ts
interface BehaviourState {
  vector:     Partial<Record<BehaviourLabel, number>>; // weights 0..1
  dominant:   BehaviourLabel;
  trajectory: "warming" | "cooling" | "flat";
  stability:  "settled" | "volatile";
}
```

Never emits raw events. This is the only thing the Intent Engine sees.

> **Sprint 4 keeps this 100% deterministic (rules + scoring).** No ML classifier. This is a direct evolution of the existing `behaviour/summarizer.ts` — from a numeric-snapshot-to-sentence function into a stateful state-vector engine.

---

## 5. Intent Engine

**Single responsibility:** map the behaviour state → **what the visitor is trying to accomplish (goal)** and **how close they are (readiness)** — two separate axes (§1). It does *not* decide whether to speak (that's the Sales Brain) and does *not* compute overall confidence (that's §6).

### 5.1 Goal taxonomy — trimmed to 6

The previous draft had 10 intents with a confusing "High/Low Intent" meta-layer that duplicated readiness. We remove the meta-intents (readiness now owns that axis) and keep **6 goals**:

| Goal | Primary behavioural inputs | Points toward |
|---|---|---|
| **Learn** | Researching, Browsing | Education / nurture |
| **Compare** | Comparing | Differentiation / positioning |
| **Evaluate Price** | Price-Sensitive | ROI/value framing |
| **Buy / Book** | Ready | Close / checkout / booking assist |
| **Get Support** | Returning + dwell on help/account | Support (never sell) |
| **Undecided** | conflicting or thin evidence | Stay silent or single probe |

### 5.2 Readiness — the separate axis

Readiness is an **ordinal derived from trajectory + the presence of action signals**, independent of goal:

| Readiness | Derived when | Meaning |
|---|---|---|
| **cold** | `Browsing`/`Researching` dominant, `flat` trajectory, no action signals | Early; observe |
| **warm** | `warming` trajectory, or `Comparing`/`Price-Sensitive` with revisits | Engaged; a probe may be earned |
| **hot** | any `cta_engage`/`form_start`, or `Ready` dominant, or `exit_signal` with prior warm | Act now (or last-chance) |

Example the previous draft conflated: **Goal = Compare, Readiness = hot** (comparing hard, about to pick) is a *very* different moment from **Goal = Compare, Readiness = cold** (idle research). Same goal, opposite action.

### 5.3 Output contract

```ts
interface IntentRead {
  goal:         Goal;                 // best goal
  readiness:    "cold" | "warm" | "hot";
  alternatives: { goal: Goal; weight: number }[]; // runner-up goals
  conflict:     boolean;              // top two goals within a small margin
  reason:       string;              // short, for the trace
}
```

The Intent Engine is **deterministic**: a mapping table from behaviour vector → goal weights, plus the readiness rules above. `conflict` and `alternatives` feed the Confidence system and let the Sales Brain reason about its own doubt.

---

## 6. Confidence System (fully specified — no placeholders)

Confidence is a **single scalar 0..1** answering "how sure are we of the behaviour+intent read?" It is computed by deterministic code, decays over time, and drives three action bands. This replaces the previous draft's vague `f(evidence, consistency, recency)`.

### 6.1 Inputs (four, each 0..1)

| Input | Definition | Computed from |
|---|---|---|
| **Evidence (E)** | How much corroborating signal exists | count of *independent* events supporting the dominant state, saturating (see 6.2) |
| **Consistency (C)** | Do behaviour, trajectory, and intent agree? | `1.0` if aligned; reduced when signals conflict (e.g. `Ready` but `cooling`/`exit`) |
| **Stability (S)** | Is the read settled or flickering? | `1.0` if `settled`, `0.6` if `volatile` |
| **Recency (R)** | Is the evidence fresh? | time-decay factor over the newest supporting evidence (6.3) |

### 6.2 Score calculation (transparent arithmetic)

```
E = 1 − exp(−k · n_independent)        // saturating; k ≈ 0.5, so n=1→0.39, n=3→0.78, n=5→0.92
C = 1 − penalty                        // penalty = 0.4 if intent.conflict, +0.3 if trajectory contradicts state
S = settled ? 1.0 : 0.6
R = 0.5 ^ (age_seconds / HALF_LIFE)    // HALF_LIFE = 45s (see 6.3)

confidence = E · C · S · R             // multiplicative: ANY weak factor pulls it down
```

**Why multiplicative, not additive:** one pricing glance with a conflicting exit signal *should* collapse confidence — a sum would let strong evidence mask the contradiction. Multiplication enforces "all factors must hold." All four are clamped to `[0,1]`; the product is the confidence.

Worked example — the flagship "price wall" moment:
`n=3` pricing revisits (E=0.78), aligned no-conflict (C=1.0), settled (S=1.0), fresh (R≈0.95) → **confidence ≈ 0.74** → High band → act.

Counter-example — same glances but cursor now racing to the tab bar:
C drops to `1 − 0.3 = 0.7`, R still 0.95 → `0.78·0.7·1.0·0.95 ≈ 0.52` → Medium → probe only, not a hard pitch.

### 6.3 Decay

- **Evidence decay:** each state weight in the Behaviour Engine multiplies by `0.5 ^ (Δt / 45s)` every window. Old evidence fades; the visitor's *current* mind dominates.
- **Recency factor R** uses the same 45s half-life over the freshest supporting event.
- **Interruption fatigue** (separate, §7.3) decays over a longer 5-minute horizon — annoyance lingers longer than attention.

`HALF_LIFE`, `k`, and the conflict penalties live in `confidence.config.ts` next to `policy.ts` — tunable without code changes.

### 6.4 Thresholds → action bands

| Band | Confidence | Behaviour |
|---|---|---|
| **High** | ≥ 0.72 | Act with a **specific, intent-matched** message. |
| **Medium** | 0.45 – 0.72 | Act **only** with a low-commitment **probe** that invites the visitor to reveal intent ("Comparing plans? I can break down the difference.") — never a hard pitch. |
| **Low** | < 0.45 | **Stay silent.** Keep observing. Silence is the default. |

### 6.5 Uncertainty handling (uncertainty is a first-class state, not an error)

- **Conflicting goals** (`intent.conflict = true`): do not guess. Either stay silent, or — if all other gates pass — the probe *asks one disambiguating question* instead of asserting.
- **Cold start / thin data:** early in a session `E` and `R` keep confidence naturally low → observe-only. We accept **lower recall for higher precision** early: a missed marginal lead is cheaper than an annoyance that poisons the session (this directly protects the interruption-regret ceiling).
- **Graceful degradation:** if RAG returns nothing relevant, or the LLM is unavailable, we **do not** bluff and **do not** fall back to random popups. We drop to rule-derived intent + a templated, grounded message, or to silence — mirroring the existing rules-engine fallback pattern.

---

## 7. AI Sales Brain — the heuristic decision policy

The heart. It consumes **behaviour + intent + readiness + confidence + business goal + conversation context** (never raw events) and produces a **Decision with a stated reason.**

### 7.1 The reasoning chain (each stage can abort to silence)

```
1. Behaviour        → state vector + trajectory + stability   (§4)
2. Intent           → goal + readiness + conflict             (§5)
3. Confidence       → scalar + band                           (§6)
4. Business Goal     → what THIS client wants (Value weights)  (§8)
5. Conversation ctx  → have we spoken this session? (§ chat)
6. Knowledge check   → does RAG actually have something true & useful to say?
7. Interruption policy → speak or stay silent? (§7.2)  ← the calculus
8. Strategy + Message → LLM: choose approach, write the words  ← ONLY LLM call
9. CTA               → single next action from the goal's CTA library
10. Final gate        → cooldown / frequency / suppression     (§7.4)
```

### 7.2 The interruption policy — heuristic, not the EV equation

The previous draft's `EV(speak) = P(engage)·Value − P(annoy)·Cost` is theoretically elegant but **not buildable in Sprint 4**: none of those probabilities are measurable without outcome data we don't yet have. We replace it with a **transparent, tunable scoring policy** that captures the *same intuition* — "want the sale, but weigh the cost of interrupting" — using only quantities we can actually compute today.

```
speakScore  =  W_conf   · confidence            // how sure are we
             + W_ready  · readinessScore        // cold=0, warm=0.5, hot=1
             + W_value  · goalValue             // from business goal config, 0..1
             − W_fatigue· interruptionFatigue   // rises with each prior interruption
             − W_bad    · badMomentPenalty      // idle / distracted / mid-form-typing / mid-fling

Decision:  speak  ⟺  speakScore ≥ SPEAK_THRESHOLD
                     AND confidence band ≠ Low
                     AND knowledge check passed
                     AND not suppressed (§7.4)
```

- All weights `W_*` and `SPEAK_THRESHOLD` live in `salesPolicy.config.ts`, per-tenant-overridable.
- `goalValue` comes from the Business Goal layer (a booked demo outscores a newsletter signup).
- This single score is why the product feels human: **it can want the sale badly and still stay quiet** when fatigue or a bad moment outweighs it.
- It is **fully deterministic and unit-testable** — you can assert exact outcomes for fixed inputs, which the probabilistic EV form never allowed.

**Migration path to a learned model (Sprint 6+, designed now so we don't repaint):**
1. **Sprint 4 (now):** hand-tuned weights. Every decision logs `{ inputs, speakScore, action, outcome }` to the reason-trace corpus.
2. **Sprint 5:** analytics surface which weight settings correlate with conversions vs. regret; we hand-adjust per vertical.
3. **Sprint 6+:** the logged `(features → outcome)` pairs become training data. `speakScore` becomes a learned function (logistic regression first — same linear shape, so it's a *drop-in* replacement of the weights, not a re-architecture). The EV formulation re-enters here as the *objective the learner optimizes*, now with real `P(engage)`/`P(annoy)` estimated from data. **The heuristic is the bootstrap; the learned model is the destination.**

### 7.3 Interruption fatigue & readiness scoring (concrete)

```
interruptionFatigue = min(1, priorInterruptions_thisSession · 0.4)   // 0, 0.4, 0.8, 1.0…
  · decays toward 0 with a 5-minute half-life (annoyance lingers)
badMomentPenalty     = 1.0 if (Distracted dominant | idle | form actively being typed | fling-scroll)
                       else 0
readinessScore       = { cold: 0, warm: 0.5, hot: 1.0 }[readiness]
```

### 7.4 Suppression & the discipline of silence

Suppress (force silent) when **any** hold — checked *before* the LLM is ever called:

- Visitor is `Distracted` / `idle` — never interrupt someone not present.
- Visitor **recently dismissed** us — respect the "no"; raise the bar sharply.
- Confidence band is **Low**.
- **Knowledge check failed** — nothing true/useful to add; no filler.
- **Frequency budget** exhausted (interruption budget per session).
- **Cooldown** active (min spacing between interruptions).
- Business goal is `Get Support` and the visitor is a returning customer with a problem — never push a sales CTA.

**Cooldown vs. Suppression vs. Frequency — three distinct mechanisms (previously blurred):**
| Mechanism | Scope | Rule |
|---|---|---|
| **Cooldown** | time | ≥ N seconds between two interruptions (default 25s, from `policy.ts`) |
| **Frequency budget** | count | ≤ K interruptions per session (default 2 for MVP; hot exit-moment may spend the last one) |
| **Suppression** | state | hard blocks above, independent of time/count |

> **The product's signature feeling** — *"how did it know exactly what I was thinking?"* — comes as much from the popups that **don't** fire as the ones that do. Restraint is the moat.

### 7.5 The reason trace (extends today's `DecisionTrace`)

Every decision emits a machine- and human-readable trace, extending the existing dev-only `debug` field in `EngageDecision`:

```ts
interface SalesDecisionTrace extends DecisionTrace {
  behaviour:    BehaviourState;
  intent:       IntentRead;
  confidence:   number;
  band:         "high" | "medium" | "low";
  speakScore:   number;
  suppressedBy: string | null;      // e.g. "cooldown", "frequency_budget", "distracted"
  strategy:     string | null;      // e.g. "roi_reframe", "trust_proof"
  because:      string;            // one human sentence
}
```

Example `because`: *"Revisited pricing 3× and stalled on the plan toggle → Price-Sensitive (0.74), goal Evaluate-Price, readiness warm. Goal=book demo (value 0.9), low prior interruptions → speakScore 0.81 ≥ 0.7. Strategy: ROI-reframe + soft demo offer."*

This trace is the **debugging surface**, the **A/B unit** (we test *strategies*, not just copy), the **client trust story**, and the **future training signal** — all four fall out of one object.

### 7.6 Where the LLM sits

The LLM (Gemini today, swappable via `LLMProvider`) is invoked **only at stage 8**, over the compact summary, once the policy has decided to speak. It never sees raw events, never gates the decision. It does the one thing it's uniquely good at: *saying the right thing, the right way.* Its output passes through the existing `responseValidator` (XSS sanitize + CTA-url allowlist) before reaching the widget.

---

## 8. Business Goal Layer

The **business goal is a first-class, per-tenant input** — it sets `goalValue` in the policy, the CTA library, tone, and the closing strategy. This is what lets one engine serve a dentist and a SaaS founder with **configuration, not code**.

### 8.1 Goal model

Each tenant configures a **primary goal** (+ optional secondary with a weight):

| Goal | Primary CTA family | Success event | Typical verticals |
|---|---|---|---|
| **Book Demo** | "See it live" | Demo booked | SaaS, B2B |
| **Book Appointment** | "Reserve a slot" / tap-to-call | Appointment set | Dentists, clinics, salons, gyms |
| **Collect Lead** | "Send me details" | Contact captured | Coaches, education, agencies |
| **Contact Sales** | "Talk to our team" | Qualified handoff | High-ticket B2B, real estate, law |
| **Sell Product** | "Checkout assist" | Purchase | E-commerce |
| **Support** | "Get this sorted" | Issue resolved / deflected | Any with existing users |

### 8.2 How the goal steers everything

- **Value weighting:** goal progress sets `goalValue` → how aggressively we're willing to interrupt.
- **Same behaviour routes differently:** Price-Sensitive under `Sell Product` → value/bundle framing; under `Book Demo` → "let's show the ROI live."
- **CTA & tone library:** each goal ships a curated CTA/tone set; the LLM selects *within* it (never invents CTAs — they map to allowlisted `siteLinks`).
- **Suppression:** a `Support` goal never pushes a sales CTA at an existing customer with a problem.
- **Config rides the existing tenant model** (`tenant/`, `instructions/`, `business-instructions.json`). New verticals = new config rows, shipped with **vertical presets** (§10.7) so a non-technical client can't mis-tune themselves into spam.

---

## 9. Mobile vs Desktop — one brain, two sensor profiles

**Non-negotiable:** exactly **one** intelligence engine. Desktop and mobile differ **only at the event-collection edge (§3)**. Everything from the Behaviour Engine up is device-blind.

```
   DESKTOP sensors            MOBILE sensors
   (hover, cursor,            (scroll depth/velocity, touch,
    text-select, tabs)         back-button, tap-to-call)
          \                          /
           ▼                        ▼
   ┌───────────────────────────────────────┐
   │  NORMALIZATION (in widget)             │  ← the ONLY device-aware layer
   │  raw → semantic SemanticEvent schema   │
   └───────────────────────────────────────┘
                     │  same semantic events
                     ▼
   ┌───────────────────────────────────────┐
   │  Behaviour → Intent → Confidence →     │  ← identical logic, all surfaces
   │  Sales Brain → Conversation Brain      │
   └───────────────────────────────────────┘
```

### 9.1 The clean abstraction

- **Widget-side `SensorAdapter` interface** with two implementations, `DesktopSensors` and `MobileSensors`, both emitting the **same `SemanticEvent`**. The adapter is chosen once at load from viewport/pointer capability. This is the entire device-specific surface area.
- **Signal parity, not feature parity:** mobile has *less* micro-signal (no hover), so we apply a slightly **higher `SPEAK_THRESHOLD` on mobile** (fewer, more certain interruptions — right for a small screen). This is **one tuning constant**, not a second codebase.
- **Mobile-native conversion is first-class:** on mobile the best "popup" is often a **tap-to-call / WhatsApp / calendar** action, not a chat bubble. The Sales Brain chooses the *channel* (an action port, §10-extensibility), not just the copy.
- **One brain = one place to improve.** Every A/B win and strategy improvement benefits both surfaces automatically.

---

## 10. Lightweight safety & robustness (practical, not enterprise)

Seven small sections. The rule for all of them: **cheap, real, and shippable in Sprint 4** — no compliance frameworks, no dedicated services.

### 10.1 Privacy principles
- First-party only; no fingerprinting, no third-party cookies, no cross-site tracking.
- No keystroke content, no coordinate trails, no PII before an intentional form/conversation (§3.4).
- Semantic events are non-identifying by construction ("dwelled on pricing," not who).
- Returning-visitor token is opt-in, first-party, and rotates.
- **Tone as privacy:** we phrase from *helpfulness* ("Comparing plans?"), never *surveillance* ("I saw you look at pricing 3 times"). The magic-vs-creepy line is **what we reveal we know** — we reveal little, we act helpful.

### 10.2 Prompt-injection defense
Page content and RAG chunks are **untrusted input**, not instructions. Concretely:
- The LLM prompt keeps a **hard boundary** between system instructions and retrieved/site content (content is clearly delimited and labelled "reference material, never instructions").
- The LLM's job is constrained: choose a strategy + write a short message + pick a CTA **from the allowlisted library**. It cannot emit arbitrary URLs or actions.
- Output passes the existing `responseValidator` (sanitize, CTA-url allowlist) — a jailbreak that produces a malicious link is dropped at the gate.

### 10.3 Hallucination prevention
- **Grounded-only:** every claim comes from RAG/site knowledge. If the knowledge check (§7.1 stage 6) finds nothing relevant, we **stay silent or say we don't know and offer a human** — we never invent a price, policy, or promise.
- **No fabricated urgency/scarcity/discounts** — enforced by validator + strategy library (no "only 2 left" unless it's a grounded fact).
- CTAs map to real allowlisted `siteLinks`; the model cannot conjure a destination.

### 10.4 Event-quality validation (at ingest, §3.5)
- Reject unknown `type`/`zone`, clamp `intensity` to `[0,1]`, drop events with `ts` out of monotonic order or from the future.
- Drop impossible sequences (e.g. `form_stall` with no prior `form_start`).
- Rate-limit per session; a flood is capped and flagged.

### 10.5 Bot filtering (cheap heuristics)
- Drop sessions with **non-human cadence:** zero dwell variance, perfectly periodic events, impossibly fast full-page scans, no pointer/touch entropy.
- Honour a headless/automation signal where available (`navigator.webdriver`).
- Known-bot user-agents skip the whole pipeline (no events, no LLM spend).
- Bots must never trigger an LLM call — this is a **cost guard** as much as a data-quality one.

### 10.6 Failure handling & fallback (never break the widget)
Every layer degrades to a **safe silence or a grounded template**, never to a crash or a random popup — the existing `engageService` try/catch philosophy, extended:
| Failure | Fallback |
|---|---|
| Event ingest error | drop the batch, keep the session; widget unaffected |
| Behaviour/Intent code throws | return `Browsing/cold/low` → silence |
| Confidence NaN/invalid | treat as Low → silence |
| RAG returns nothing | knowledge check fails → silence (never bluff) |
| LLM unavailable / times out | rule-derived intent + templated grounded message, or silence |
| Anything unexpected | `{ showPopup: false }` — the widget can never be broken by the backend |

### 10.7 Client misconfiguration guardrails
- **Vertical presets** ship sane goals/tones/thresholds per vertical (dentist, SaaS, e-com…). A client picks a preset, not raw numbers.
- Config ranges are clamped (a client cannot set frequency budget to 50).
- The reason-trace/analytics loop (Sprint 5) surfaces "you're interrupting too much / too little" so misconfiguration is *visible*.

---

## 11. Implementation Roadmap — three independently-testable milestones

Each sub-sprint ships something **shippable and testable on its own**. We do **not** build all layers then integrate — we build a thin vertical slice first, then deepen.

### Sprint 4.1 — "Perception loop, end to end" (thin vertical slice)
**Goal:** semantic events flow from widget → server-side session → deterministic Behaviour+Intent+Confidence → a *silent* decision with a full reason trace. **No LLM changes, no new popups yet.**
- Widget: `SensorAdapter` (desktop + mobile), the **8 MVP events (§3.2)**, batched `POST /events`.
- Backend: `POST /events` ingest (validate + bot-filter + attach to S2 session store).
- Behaviour Engine (deterministic, 8 states, decay, trajectory, stability).
- Intent Engine (6 goals + readiness).
- Confidence system (§6 arithmetic).
- Sales Brain policy computes `speakScore` but **only logs** the decision + reason trace (shadow mode).
- **Independently testable:** golden-file tests — feed recorded event sequences, assert exact behaviour vector / intent / confidence / speakScore. Verify on the local Creovix test site via the dev debug trace. *Success = traces look right; zero user-facing change.*

### Sprint 4.2 — "Earned interruptions" (turn on the mouth)
**Goal:** the Sales Brain actually speaks, replacing the timer/URL popup with the psychology-driven one.
- Wire the LLM strategy+message stage (stage 8) behind the policy decision; reuse `LLMProvider`, `responseValidator`, RAG `ResolvedContext`.
- Business Goal layer: `goalValue`, CTA/tone library, vertical presets (§10.7).
- Cooldown / frequency budget / suppression (§7.4) enforced **server-side** (retire the widget-trusted counters).
- Confidence bands → popup posture (High=specific, Medium=probe, Low=silent).
- **Independently testable:** run the 8 scenario fixtures (§11.5) as integration tests asserting *speak/silent + strategy*; manual pass on the test site across desktop **and** mobile emulation. *Success = right popups fire, wrong ones don't.*

### Sprint 4.3 — "Continuity & polish" (the employee remembers)
**Goal:** proactive engagement flows into conversation without losing context; safety hardening; metrics wired.
- Conversation hand-off: the opened chat already knows *why* it opened (carry the reason trace into `/chat` context) — never "how can I help?" when it knows they were stuck on pricing.
- Mid-conversation intent re-detection + support-vs-sales rerouting.
- Full safety pass (§10): prompt-injection boundary, hallucination guard, event-quality validation, bot filtering.
- Emit the **observer events** for metrics (§12) to the analytics sink (read in Sprint 5).
- **Independently testable:** conversation-continuity fixtures; adversarial prompt-injection test suite; bot-traffic replay shows zero LLM calls. *Success = metrics populate and the safety suite is green.*

### 11.5 The scenario fixtures (the acceptance corpus)
We keep **8 representative scenarios** as the living test corpus (trimmed from the previous 30; the rest become Sprint 5 regression cases). Each is a recorded event sequence with an asserted expected decision:

1. **Price-wall (SaaS, desktop):** pricing revisits + stall → *speak, ROI-reframe, demo CTA.*
2. **Nervous first-timer (dentist, desktop):** dwell on "is it painful" + testimonials → *speak, trust-proof.*
3. **Cart hesitator (e-com):** add-to-cart → checkout `form_stall` → *speak, dissolve-objection.*
4. **Toothache urgent (dentist, mobile):** scroll-stop "emergency" + tap-to-call proximity → *speak, tap-to-call channel.*
5. **Exit with real intent (gym):** pricing dwell → `exit_signal` → *speak once, reframe (spends last budget).*
6. **Window-shopper (any):** fling scroll, no dwell → **silent** (the intelligence is the restraint).
7. **Distracted (any):** `idle`/`resume`, incoherent path → **silent** even with some prior interest.
8. **Returning support user (SaaS):** return token + account zone dwell → *support message, never a sales CTA.*

Scenarios 6, 7, 8 (the *silences* and the *don't-sell*) are the most important tests — they guard the non-negotiables a chatbot fails.

---

## 12. Launch Metrics — what Sprint 4 success means

These are wired in 4.3 and read in the Sprint 5 dashboard. They exist to guide optimization, not to be enterprise analytics.

### 12.1 Primary (the north star and its guardrail)
| Metric | Definition | Target direction |
|---|---|---|
| **Assisted conversion lift / 1k sessions** | goal-success events attributable to an AI interaction, vs. baseline | ↑ (north star) |
| **Interruption regret rate** | share of interruptions followed by dismiss/ignore **and** engagement drop | ↓ **hard ceiling** — a rise here vetoes any conversion gain |

### 12.2 Funnel metrics
| Metric | Definition |
|---|---|
| **Popup CTR** | popups clicked / popups shown |
| **Conversation start rate** | chats opened / popups shown |
| **Dismiss rate** | popups explicitly dismissed / shown |
| **Lead rate** | leads captured / sessions |
| **Booking rate** | demos/appointments booked / sessions |
| **Avg conversation quality** | proxy: turns + goal-progress reached (simple 1–5 heuristic, not ML) |

### 12.3 Precision/recall of the *decision to speak* (the model's own scorecard)
| Metric | Definition | Why it matters |
|---|---|---|
| **False-positive rate** | popups that fire and are dismissed/ignored | measures annoyance — must stay low |
| **False-negative rate** | high-intent sessions we stayed silent on that then bounced | measures missed opportunity |

> **The tuning tension Sprint 4 is built to manage:** lowering `SPEAK_THRESHOLD` cuts false-negatives but raises false-positives and regret. The metrics above make that trade-off *visible and adjustable per vertical* — which is exactly what the heuristic policy (§7.2) and its later learned successor optimize.

---

## 13. Architecture decisions that were CHANGED

1. **EV probability equation → transparent heuristic `speakScore` policy** (§7.2), with a documented migration path to a learned model. *Reason: the EV probabilities aren't measurable pre-launch; the heuristic is buildable and unit-testable today and becomes the learner's bootstrap.*
2. **Behaviour states 14 → 8** (§4.2). Merged Window-Shopping→Browsing, Confused→Hesitating; collapsed the three customer-lifecycle states into a `Returning` flag. *Reason: fewer states, less psychological over-interpretation, all still expandable.*
3. **Intents 10 → 6, and removed the "High/Low Intent" meta-intents** (§5.1). *Reason: those duplicated the readiness axis.*
4. **Intent split into two explicit axes: Goal + Readiness** (§1, §5.2). *Reason: the single most important fix — "Compare + hot" ≠ "Compare + cold."*
5. **Confidence formula fully specified** (E·C·S·R, multiplicative, with decay and bands) (§6). *Reason: the previous `f(...)` was a placeholder.*
6. **Cooldown / Frequency / Suppression separated into three distinct mechanisms** (§7.4). *Reason: they were blurred; each now has one rule.*
7. **Session state moved server-side** (§3.5). *Reason: closes the Sprint-1 "widget owns the counters" gap; a precondition for real proactivity.*
8. **30 scenarios → 8 acceptance fixtures** (§11.5). *Reason: turned an illustrative catalog into an executable test corpus; the rest become Sprint 5 regressions.*
9. **Roadmap added as three independently-testable slices** (§11). *Reason: the doc had no buildable milestones.*
10. **Device abstraction pinned to a concrete `SensorAdapter` interface + one `SPEAK_THRESHOLD` tuning constant** (§9). *Reason: "one brain" is now an enforceable code boundary, not a principle.*

## 14. Architecture decisions intentionally KEPT

1. **The three-layer perception stack** (events → behaviour → intent → brain).
2. **Raw events never reach the LLM** — hard boundary (§2).
3. **Silence as the default and a feature** (§7.4).
4. **One unified engine; device only at the edge** (§9).
5. **Psychology over page-rules** — no timer/URL popups.
6. **Weighted state *vectors*, not hard labels** — humans are mixtures (§4.2).
7. **The reason trace on every decision** — debugging + A/B + trust + future training, from one object (§7.5).
8. **Ports pattern for extensibility** (input/action/observer), proven by the existing `LLMProvider` (§ below).
9. **Business goal as the configurable objective function** — one engine, many verticals (§8).
10. **Grounded-only, no-bluff conversation** — extends the existing `responseValidator` (§10.3).

## 15. Items POSTPONED to Sprint 5+

Kept only as roadmap references; **not built in Sprint 4**:
- **ML behavioural classifier / learned `speakScore`** — needs the Sprint 4 reason-trace corpus first (migration path in §7.2).
- **Self-learning / online optimization / data flywheel** — Sprint 6+.
- **Advanced experimentation platform** (multi-armed bandits over strategies) — the *reason trace* makes it possible later; the A/B *engine* is Sprint 5+.
- **Replay simulators / offline evaluation harness** beyond the 8 fixtures — Sprint 5.
- **Enterprise compliance (GDPR tooling, DPA, audit exports)** — beyond the lightweight privacy stance in §10.1.
- **Full analytics dashboard** — Sprint 5 (Sprint 4 only *emits* the metric events).
- **Cross-session memory & returning-visitor personalization** at depth — minimal token in 4.3; richer in Sprint 5.
- **Deferred event types** (`search_or_filter`, `content_velocity`, `rage_click`, `tab_blur`, etc., §3.2) — additive, turned on post-MVP.
- **Voice / WhatsApp / CRM / calendar adapters** — the ports exist; the adapters are Sprint 6.

## 16. Sprint 4 implementation checklist

**Extensibility ports (design in, so nothing re-architects later):** the intelligence core stays fixed while **input ports** (new sensors/channels emit the same `SemanticEvent`), **action ports** (Brain emits abstract actions — "book appointment", "tap-to-call" — fulfilled by adapters), and **observer ports** (every Decision + trace on an event bus for analytics/A/B/learning) hang off the edges. Same pattern as `LLMProvider`. Only the **observer port** is wired this sprint (for metrics); input/action ports are interfaces we design now and implement in Sprint 6.

### Sprint 4.1 — Perception loop (shadow mode)
- [ ] `SemanticEvent` schema + closed `Zone`/`SemanticType` enums (shared widget/backend type).
- [ ] Widget `SensorAdapter` interface + `DesktopSensors` + `MobileSensors` emitting the 8 MVP events.
- [ ] Backend `zoneMap` generation from the existing crawl; served to widget at load.
- [ ] `POST /events` batched ingest: schema-validate + event-quality checks (§10.4) + bot-filter (§10.5).
- [ ] Server-side session store (S2) attach; retire widget-trusted counters.
- [ ] Behaviour Engine: 8 states, `behaviourRules.ts` table, decay, trajectory, stability → `BehaviourState`.
- [ ] Intent Engine: 6 goals + readiness → `IntentRead` (with `conflict`/`alternatives`).
- [ ] Confidence system: `confidence.config.ts` (k, HALF_LIFE, penalties) + E·C·S·R + bands.
- [ ] Sales Brain policy computes `speakScore` in **shadow mode** (log-only) → `SalesDecisionTrace`.
- [ ] Golden-file tests: event sequence → asserted behaviour/intent/confidence/speakScore.

### Sprint 4.2 — Earned interruptions
- [ ] Wire LLM strategy+message stage (stage 8) behind the policy, reusing `LLMProvider` + RAG `ResolvedContext` + `responseValidator`.
- [ ] Business Goal layer: `goalValue`, CTA/tone library, vertical presets, config clamps (§8, §10.7).
- [ ] Server-side cooldown / frequency budget / suppression (§7.4).
- [ ] Confidence band → popup posture (specific / probe / silent).
- [ ] Extend `EngageDecision.debug` → `SalesDecisionTrace`.
- [ ] Integration tests: the 8 scenario fixtures assert speak/silent + strategy, desktop + mobile.

### Sprint 4.3 — Continuity, safety, metrics
- [ ] Carry the reason trace into `/chat` context (chat opens knowing *why*).
- [ ] Mid-conversation intent re-detection + support/sales rerouting.
- [ ] Safety pass: prompt-injection boundary (§10.2), hallucination guard (§10.3), full ingest validation + bot filtering.
- [ ] Observer port: emit metric events (§12) to the analytics sink.
- [ ] Adversarial test suite (prompt-injection) + bot-replay (asserts zero LLM calls) green.

### Cross-cutting acceptance for "Sprint 4 done"
- [ ] All 8 scenario fixtures pass, **including the three silences** (window-shopper, distracted, returning-support-no-sell).
- [ ] Zero raw events ever reach the LLM (verified by the compact-summary boundary).
- [ ] Desktop and mobile run the **same** engine code above the `SensorAdapter`.
- [ ] Every decision carries a one-sentence `because`.
- [ ] The widget cannot be broken by any backend failure (all paths degrade to safe silence).

---

## Appendix A — Mapping onto the existing codebase (Sprints 1–3)

| Sprint 4 layer | Builds on / becomes |
|---|---|
| Event schema + `SensorAdapter` | new responsibility in `widget/src/tracker/*` (edge stays dumb); `VisitorBehaviour` generalizes to the event stream |
| `POST /events` ingest | new route beside `routes/engage.ts`; uses the S2 session store |
| Behaviour Engine | evolves `backend/src/behaviour/summarizer.ts` from snapshot→sentence into a stateful state-vector engine |
| Intent Engine | new layer between behaviour and the prompt builders |
| Confidence system | new `confidence.config.ts` beside `config/policy.ts` |
| Sales Brain policy | generalizes `rules/rulesEngine.ts` (pre/post gates) into the `speakScore` policy + `SalesDecisionTrace` |
| LLM strategy/message | unchanged `llm/` + `LLMProvider` + `prompts/*` + `validation/responseValidator.ts` |
| Business Goal layer | rides `tenant/` + `instructions/` + `config/business-instructions.json` |
| Knowledge | already solved — RAG `ResolvedContext` (Sprint 2); the Brain consumes it, never bluffs beyond it |
| Observer port (metrics) | new, minimal event bus; read by the Sprint 5 dashboard |

*This document is the blueprint Sprint 4 implements against. It preserves the AI-Sales-Employee vision intact while making every layer buildable, testable, and cheap enough to ship.*
