# Sprint 5.1 Analytics Foundation Walkthrough

## Purpose

Sprint 5.1 builds the analytics foundation for the AI Sales Employee.

The goal is not lead capture, CRM, billing, or conversation persistence. The goal is to measure what is happening inside the visitor journey, popup pipeline, chat interactions, knowledge builds, and AI popup decisions.

After this sprint, the system can answer questions such as:

- How many visitors came today?
- How many visitors opened chat?
- How many popups were shown?
- Which popup type has the highest CTR?
- Which pages generate the most conversations?
- Which website performs best?
- How many AI responses were generated?
- How many conversations ended without engagement?
- Why was a popup generated or suppressed?

## Architecture

The analytics pipeline is independent of the popup and chat pipelines.

```text
Visitor
-> Widget Events
-> Backend Analytics API
-> Database
-> Analytics Aggregator
-> Dashboard
```

AI popup decisions are logged through the same analytics foundation but remain separate from the popup generation path:

```text
Widget Events
-> Behavior Engine
-> Intent Engine
-> Sales Brain
-> Popup Pipeline
-> AI Decision Log
-> Analytics Dashboard
```

Important rule:

Analytics collection must never block popup generation, chat, RAG, crawler, or knowledge builds.

## Database Additions

The analytics schema is multi-tenant and website-scoped.

Added analytics models:

- `AnalyticsVisitor`
- `AnalyticsSession`
- `AnalyticsEvent`
- `AiDecisionLog`

Main migrations:

- `backend/prisma/migrations/20260707010100_add_analytics_foundation/migration.sql`
- `backend/prisma/migrations/20260708010100_add_ai_decision_log/migration.sql`

Important design choices:

- Events are stored as records, not huge JSON blobs.
- Common dimensions are first-class columns.
- Every analytics row stores `organizationId` and `websiteId`.
- Individual website dashboards must filter by `websiteId`.
- Global analytics can aggregate across websites only when intentionally unscoped.

## Backend Analytics Pipeline

Main files:

- `backend/src/analytics/analytics.service.ts`
- `backend/src/analytics/analytics.routes.ts`
- `backend/src/analytics/decision-log.service.ts`
- `backend/src/routes/events.ts`

Public widget endpoint:

```text
POST /analytics/events
```

Authenticated dashboard endpoints:

```text
GET /api/analytics/summary
GET /api/analytics/charts
GET /api/analytics/decision-log
```

The backend resolves public `siteId` into canonical tenant identity:

```text
siteId -> Website -> organizationId + websiteId
```

Then it persists analytics under the resolved website.

## Events Tracked

Visitor lifecycle:

- `visitor_started`
- `returning_visitor`
- `session_started`
- `session_ended`
- session duration

Page:

- `page_viewed`
- `page_exited`
- page duration
- referrer
- device
- browser

Popup:

- `popup_requested`
- `popup_generated`
- `popup_displayed`
- `popup_dismissed`
- `popup_clicked`
- `popup_suppressed`

Chat:

- `chat_opened`
- `chat_closed`
- `message_sent`
- `ai_response_completed`
- `source_button_clicked`

Knowledge:

- `knowledge_build_started`
- `knowledge_build_completed`
- `knowledge_build_failed`

Widget:

- `widget_loaded`
- `widget_initialized`

## Widget Analytics

Main files:

- `widget/src/analytics/analytics.ts`
- `widget/src/core/orchestrator.ts`
- `widget/src/chat/chat.ts`
- `widget/src/sensors/index.ts`
- `widget/src/sensors/session.ts`

The widget tracks:

- anonymous visitor ID
- anonymous session ID
- current page URL/path/title
- browser and device
- popup outcomes
- chat outcomes

The widget analytics calls are fire-and-forget. If analytics fails, visitor-facing behavior should continue normally.

## Dashboard Analytics Page

Main files:

- `dashboard/src/app/(dashboard)/analytics/page.tsx`
- `dashboard/src/app/(dashboard)/websites/[id]/page.tsx`
- `dashboard/src/components/analytics-view.tsx`
- `dashboard/src/lib/api.ts`

The Analytics page displays:

- Today's Visitors
- Today's Conversations
- Today's Popup CTR
- Today's Chat Opens
- Messages
- AI Responses
- Top Pages
- Top Popup Types
- Device Breakdown
- Website Performance
- Conversations Ended Without Engagement
- Daily Visitors chart
- Daily Chats chart
- AI Decision Log

The same `AnalyticsView` component supports two modes:

- Global organization analytics when no `websiteId` is passed.
- Website-scoped analytics when `websiteId` is passed.

## Tenant Isolation Fix

A bug was found where website-level dashboards showed analytics from other websites.

Root cause:

- Some dashboard requests did not pass the current `websiteId`.
- Some backend aggregations still behaved like organization-wide aggregates.

Fix:

- Website dashboards now pass `websiteId` to summary, charts, and AI decision log APIs.
- Backend endpoints assert website ownership before applying the website filter.
- Summary, charts, top pages, popup metrics, chat metrics, visitor metrics, conversation metrics, and device breakdown all filter by `websiteId` when scoped.

Verified websites:

- Creovix: `2c32cd33-3119-4c11-8d84-71325184020c`
- Colour Trading: `921a02c4-ecf3-4183-b57d-25ea38f7887f`

Expected result:

- Creovix dashboard shows only Creovix data.
- Colour Trading dashboard shows only Colour Trading data.
- No page, visitor, popup, chat, conversation, chart, or decision log data leaks across tenants.

Verification script:

- `backend/scripts/verify-analytics-isolation.ts`

## AI Decision Log

The AI Decision Log explains why popups are generated or suppressed.

Main files:

- `backend/src/analytics/decision-log.service.ts`
- `backend/src/routes/events.ts`
- `backend/src/analytics/analytics.routes.ts`
- `dashboard/src/components/analytics-view.tsx`

Each decision log records:

- timestamp
- website
- session ID
- visitor ID
- current page
- behavior summary
- intent summary
- sales strategy
- confidence score
- decision
- reason
- popup generated
- popup suppressed
- suppression reason
- generated popup type
- generated popup title
- CTA type
- CTA text
- LLM used
- validation passed
- final outcome
- popup displayed
- popup clicked
- popup dismissed
- chat opened

Decision logs are asynchronous. They must not add latency to popup generation.

## AI Decision Log Dashboard Filters

The dashboard supports filtering by:

- website
- decision
- popup type
- exact session
- date
- session search

Rows are newest first.

Website dashboards are scoped by `websiteId`. The global analytics page can intentionally show organization-wide logs.

## AI Decision Log Download

The AI Decision Log section includes a date-range download flow.

Dashboard behavior:

- User selects `From` and `To` dates.
- User clicks `Download Log`.
- The dashboard requests all AI decision logs for that date range and current website scope.
- The browser downloads a readable `.txt` file.

Backend support:

```text
GET /api/analytics/decision-log?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&export=1
```

Export mode supports up to 5000 rows while preserving tenant filters.

The downloaded file includes full details for every decision, including rejected popup title and CTA when validation fails.

## Popup Decision Trace Logging

The popup pipeline was instrumented so every important stage prints pass/fail status.

Trace stages:

1. Widget event collection
2. Event quality
3. Behavior Engine
4. Intent Engine
5. AI Sales Brain
6. Popup eligibility
7. Suppression rules
8. Cooldown
9. Popup generation
10. Popup delivery to widget
11. Widget rendering

Logged fields include:

- current behavior
- current intent
- popup confidence
- suppression reason
- cooldown remaining
- popup generated true/false

If a popup is suppressed, the logs should explain why.

## GenerateLead CTA Validation Fix

A fresh AI Decision Log export showed new `cta_not_allowed` rows for Colour Trading.

Observed pattern:

- Sales Strategy: `GenerateLead`
- CTA Type: `capture_lead`
- LLM Used: `true`
- Validation Passed: `false`
- Suppression Reason: `cta_not_allowed`

Investigation found two validators:

- `validatePreLlmSafety`: checks strategy-level CTA intent before LLM.
- `validatePopupResponse`: checks generated CTA text after LLM.

The failing branch was:

```text
validatePopupResponse -> ctaMatchesIntent
```

Root cause:

The `capture_lead` CTA allowlist was too narrow. Valid lead CTAs such as `Claim Gift Code`, `Join Now`, and `Access Details` could be rejected.

Fixes:

- Centralized CTA rules in `CTA_RULES`.
- Expanded valid `capture_lead` language.
- Added concrete prompt examples for capture lead CTAs.
- Added validator diagnostics for future `cta_not_allowed` failures.
- Persist rejected popup title/type/CTA into AI Decision Log.

Diagnostics now print:

- generated popup title
- generated CTA text
- generated CTA type
- validation rule that failed
- exact validator branch
- expected allowed values

Verification script:

- `backend/scripts/verify-lead-cta-validation.ts`

Verification result:

```json
{
  "generatedLeadPopups": 20,
  "ctaNotAllowedOccurrences": 0
}
```

## How To Run The App

Backend:

```bash
cd backend
npm run dev
```

Dashboard:

```bash
cd dashboard
npm run dev
```

Default URLs:

```text
Backend: http://localhost:8787
Playground: http://localhost:8787/playground.html
Dashboard: http://localhost:3000
```

On this Windows setup, Node dev servers and tests may need unsandboxed execution because `tsx`, `esbuild`, or the Node test runner can fail with `spawn EPERM` inside the sandbox.

## Verification Commands

Backend typecheck:

```bash
cd backend
npm run typecheck
```

Dashboard typecheck:

```bash
cd dashboard
npx tsc -p tsconfig.json --noEmit
```

Backend tests:

```bash
cd backend
npm run test
```

Analytics tenant isolation:

```bash
cd backend
npx tsx scripts/verify-analytics-isolation.ts
```

AI Decision Log end-to-end verification:

```bash
cd backend
npx tsx scripts/verify-ai-decision-log.ts
```

GenerateLead CTA validation verification:

```bash
cd backend
npx tsx scripts/verify-lead-cta-validation.ts
```

## Final Verified State

Latest verified checks:

- Backend typecheck passed.
- Dashboard typecheck passed.
- Backend tests passed: `66/66`.
- AI Decision Log verifier passed.
- Analytics tenant isolation verifier passed.
- GenerateLead CTA verifier passed with 20 generated lead popups and 0 `cta_not_allowed` occurrences.

## Current Outcome

Sprint 5.1 now provides:

- reusable analytics event pipeline
- scalable multi-tenant analytics schema
- widget analytics tracking
- backend analytics aggregation
- website-scoped dashboards
- AI Decision Log explainability
- decision-log date-range download
- popup decision trace diagnostics
- validated GenerateLead capture CTA handling

No lead capture, CRM, billing, or conversation persistence was implemented.
