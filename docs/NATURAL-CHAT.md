# Natural chat with bounded API use

The shared backend now defaults to `CHAT_RESPONSE_MODE=hybrid`. It applies to every tenant using the normal chat endpoint; no gym or dental domain is hardcoded. Popup generation keeps its existing pipeline. Production ingestion uses the HTTP/HTML crawler on Render Free; JavaScript-only sources require a future browser-capable infrastructure decision. Widget verification reports such installations as inconclusive and preserves an existing verified state.

## Request flow

1. Resolve visitor intent and language. Greetings and thanks use reviewed local speech without embeddings or generation.
2. Refresh enabled business actions. For an eligible standalone public FAQ, check a validated-answer cache before retrieval.
3. On a cache miss, retrieve tenant-scoped evidence using vector similarity plus local BM25 ranking. Keep whole source units and existing source, subject, conflict and budget protections.
4. Send the question, bounded conversation history and retrieved evidence to the configured generation provider, including when evidence is missing. Ask for a concise natural reply, a useful partial answer, or an honest explanation of what cannot be confirmed.
5. Buffer the draft before delivery. Reject unauthorized destinations, unsupported amounts, false completed transactions, unauthorized contact requests and wrong scripts. Accept a narrow exact supported answer through existing checks; otherwise use a bounded structured semantic review of support, completeness, qualifications, language and source IDs. Multipart answers cannot bypass completeness review just because one price is correct.
6. Deliver the validated reply with server-selected source citations. On provider/review failure, use the existing source-grounded fallback. Never expose a rejected or incomplete draft.
7. Cache only complete, validated public factual replies. Recheck cache identity after generation to avoid caching across a concurrent source/settings/action change.

Contact-submission acknowledgements stay server-owned. The model cannot claim that a booking, email or saved contact operation happened merely because it generated that text. The assistant remains an AI representative while speaking naturally.

## Cache boundaries and freshness

The cache is a bounded, process-local LRU with a five-minute TTL and 250 entries by default. Restarts and multiple backend instances can lower the hit rate; they do not share entries.

Identity includes website ID, source origin and source text/version, owner instructions, enabled actions, language, normalized question, current page, initial opener and model configuration. Reading the current knowledge version must succeed; stale registry fallback is insufficient for cache reuse. Answers are not reused across tenants.

Eligibility is deliberately conservative: factual standalone questions only, either a first question or an identical normalized repeat without intervening different user questions. Personal questions, contextual follow-ups, memories/summaries, lead invitations, source requests, partial answers, missing-data replies and provider-failure fallbacks are excluded. Similar-looking questions with different meaning are not merged through a fuzzy semantic cache. Common typo normalization still applies.

## API calls and cost

| Path | Query embedding | Answer generation | Semantic review |
| --- | --- | --- | --- |
| Hi / thanks | No | No | No |
| Eligible validated FAQ cache hit | No | No | No |
| New narrowly supported exact answer | Usually one | One successful generation | No |
| New paraphrase, partial, unknown or multipart answer | Usually one | One successful generation | Usually one |
| Contact-submission acknowledgement | May retrieve | No | No |

Provider retries/fallbacks can add attempts. This is not a one-call guarantee for every new question. Semantic review adds tokens and latency to protect factual quality; cached repeats avoid those costs. There is no hard daily spending cap or new paid crawler dependency.

Evidence is included once instead of duplicating large fact contracts. History and output are bounded. Stable prompt prefixes permit provider caching when the provider supports it; discounts are not assumed or forced by padding. The answer and review use the existing configured provider/model selection.

`[chat] natural route` logs route and reason codes. `[chat] token usage` records actual provider/model, input/output tokens and available cached/reasoning token counts separately for `answer` and `grounding`. These new usage logs contain no question, prompt or draft text. They are not an invoice ledger: embeddings, other endpoints and failed attempts without reported usage need separate accounting. Existing debug tracing remains separately controlled by `DEBUG_TRACE`.

## Configuration and rollback

| Variable | Default | Purpose |
| --- | --- | --- |
| `CHAT_RESPONSE_MODE` | `hybrid` | Set `rules` and restart to return to the previous chat response path. |
| `CHAT_ANSWER_CACHE` | `true` | Set `false` to bypass answer caching. |
| `CHAT_CACHE_TTL_SECONDS` | `300` | Cache lifetime, bounded to 1–3600 seconds. |
| `CHAT_CACHE_MAX_ENTRIES` | `250` | Per-process capacity, bounded to 1–1000. |
| `CHAT_MAX_OUTPUT_TOKENS` | `700` | Writer output limit, bounded to 128–2000. Review output is capped at 600. |
| `CHAT_DEADLINE_MS` | `45000` | Writer/review deadline, bounded to 5000–60000 ms; earlier retrieval is separate. |

No database migration is required. These changes were implemented locally; this document is not a deployment record. Before a future release, use representative tenant questions and verify both the actual configured primary provider and production response times. Validation reduces errors but cannot guarantee perfect model reasoning or recover information absent from the crawl/index.

## Implementation map

- `backend/src/services/naturalChatService.ts`: routing, generation, validation, fallback and usage metadata.
- `backend/src/services/chatAnswerCache.ts`: conservative eligibility, version identity, TTL and LRU.
- `backend/src/services/chatGrounding.ts`: deterministic checks and semantic review.
- `backend/src/prompts/naturalChatPrompt.ts`: concise source-based conversation policy.
- `backend/src/context/lexicalRanking.ts`, `retrievalSelection.ts`, `retriever.ts`: hybrid chat retrieval.
- `backend/src/vectorstore/registry.ts`: strict fresh-version option for cache lookup.
- `backend/src/llm/provider/`: bounded generation and actual provider usage reporting.

The OpenAI adapter follows the official [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) for completion limits and streamed usage. Prefix reuse follows [prompt caching guidance](https://developers.openai.com/api/docs/guides/prompt-caching).
