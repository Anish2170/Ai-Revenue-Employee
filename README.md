# AI Revenue Employee — Sprint 1

Foundation of a proactive "AI sales employee" that observes visitor behaviour and intelligently decides
**when** and **how** to start a conversation. Sprint 1 proves exactly that one thing — nothing more
(no database, auth, dashboard, RAG, analytics, or multi-tenant; those are later sprints).

## Components

| Package | What it is |
| --- | --- |
| `widget/` | Framework-independent embeddable JS widget (TypeScript → single IIFE via esbuild). Tracks behaviour, calls the backend, renders the popup + chat. **No business logic.** |
| `backend/` | Minimal Express + TypeScript backend. Two endpoints (`/engage`, `/chat`). Rules engine → context provider → prompt builder → Gemini → response validator. **All intelligence lives here.** |

The widget build outputs to `backend/public/widget.js`, so the backend serves the widget **and** a dev
harness page from one origin.

## Architecture (engage pipeline)

```
widget → POST /engage
  → rulesEngine.shouldEvaluate()   pre-LLM gate (eligibility, cooldown, dedup) — may skip the LLM entirely
  → getBusinessContext()           Context Provider (static today; crawler/RAG later)
  → summarize()                    deterministic NL summary of behaviour (no LLM)
  → engagePromptBuilder.build()    versioned, isolated prompt construction
  → llm.generateDecision()         Gemini, structured JSON output
  → responseValidator              validate + clamp + sanitize → safe decision
  → rulesEngine.finalizeDecision() post-LLM gate (confidence floor, dedup)
→ widget renders popup → chat (POST /chat, SSE streaming)
```

The LLM sits behind a generic `LLMProvider` port — swap Gemini for OpenAI/Anthropic/Grok by implementing
two methods, with zero business-logic change. A dev-only `debug` trace on `/engage` reports which rule
matched, whether the LLM was called, the prompt version, and timing.

## Run it locally

Prerequisites: Node 18+ and a [Google Gemini API key](https://aistudio.google.com/app/apikey).

```bash
# 1. Backend env
cd backend
cp .env.example .env          # then set GEMINI_API_KEY in .env
npm install

# 2. Build the widget (outputs to backend/public/widget.js)
cd ../widget
npm install
npm run build                 # or: npm run watch  (rebuild on change)

# 3. Start the backend (serves API + widget + harness)
cd ../backend
npm run dev
```

Open <http://localhost:8787/playground.html>. Scroll, wait ~30s, click, or focus the form. Watch the
Network tab for `POST /engage` and the Console for `[AIRE]` logs. When the backend decides to engage, an
AI-generated popup appears; click its CTA to open the streaming chat.

### Embedding on any site

```html
<script src="https://your-host/widget.js" data-site-id="your-site"></script>
```

Optional attributes: `data-backend="https://api.your-host"` (defaults to the widget's origin),
`data-debug="true"` (console logs).

## Endpoints

- `POST /engage` → `{ showPopup, intent, confidence, message, cta, debug? }`
- `POST /chat` → Server-Sent Events: `data:{"token":"…"}` … `data:[DONE]`
- `GET /health` → `{ ok, llm, model, env }`

## Notes

- Graceful degradation: with no/invalid `GEMINI_API_KEY`, `/engage` returns `{showPopup:false}` and the
  host page is never broken.
- Sprint-1 statelessness: per-visitor cooldown/frequency/dedup counters are owned by the widget and sent
  to the stateless backend rules engine. Sprint 2 moves these server-side behind the same interface.
