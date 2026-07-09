# Sprint 5.1 - Analytics Foundation

## Goal

Build the analytics foundation for the AI Sales Employee without implementing lead capture, CRM, billing, or conversation persistence.

The analytics layer was added around the existing widget, popup, chat, knowledge, and dashboard architecture. It is designed as a reusable event pipeline rather than page-specific counters.

## Architecture Added

Visitor
-> Widget analytics events
-> Backend analytics API
-> Database event/session/visitor tables
-> Analytics aggregation endpoints
-> Dashboard Analytics page

Analytics collection is independent of the popup/chat pipeline. Widget analytics calls are fire-and-forget, and backend analytics writes are queued asynchronously so they do not block popup generation, chat, RAG, crawler, or knowledge builds.

## Database

Added scalable multi-tenant Prisma analytics models:

- `AnalyticsVisitor`
- `AnalyticsSession`
- `AnalyticsEvent`
- `AnalyticsEventCategory`

The schema uses first-class columns for dashboard dimensions such as organization, website, visitor, session, event name, page path, popup type, device, browser, source, duration, and reason. It avoids large JSON blobs.

Migration added:

- `backend/prisma/migrations/20260707010100_add_analytics_foundation/migration.sql`

Schema updated:

- `backend/prisma/schema.prisma`

## Backend

Added analytics service and routes:

- `backend/src/analytics/analytics.service.ts`
- `backend/src/analytics/analytics.routes.ts`

Public widget endpoint:

- `POST /analytics/events`

Authenticated dashboard endpoints:

- `GET /api/analytics/summary`
- `GET /api/analytics/charts?metric=daily_visitors`
- `GET /api/analytics/charts?metric=daily_chats`
- `GET /api/analytics/charts?metric=popup_ctr`
- `GET /api/analytics/charts?metric=conversation_trend`

Backend popup-stage analytics were added to `backend/src/routes/events.ts` for:

- `popup_requested`
- `popup_generated`
- `popup_suppressed`

Knowledge build analytics were added to `backend/src/knowledge/knowledge.service.ts` for:

- `knowledge_build_started`
- `knowledge_build_completed`
- `knowledge_build_failed`

## Widget

Added widget analytics tracker:

- `widget/src/analytics/analytics.ts`

Updated session identity helpers:

- `widget/src/sensors/session.ts`

The widget now tracks anonymous first-party visitor and session identity, with no third-party cookies and no fingerprinting.

Instrumented widget lifecycle and page events:

- `widget_loaded`
- `widget_initialized`
- `visitor_started`
- `returning_visitor`
- `session_started`
- `session_ended`
- `page_viewed`
- `page_exited`

Instrumented popup events:

- `popup_displayed`
- `popup_dismissed`
- `popup_clicked`
- `popup_suppressed`

Instrumented chat events:

- `chat_opened`
- `chat_closed`
- `message_sent`
- `ai_response_completed`
- `source_button_clicked`

Updated files:

- `widget/src/core/orchestrator.ts`
- `widget/src/chat/chat.ts`
- `widget/src/sensors/index.ts`
- `widget/src/sensors/session.ts`

## Dashboard

Added Analytics navigation item in:

- `dashboard/src/app/(dashboard)/layout.tsx`

Added Analytics page:

- `dashboard/src/app/(dashboard)/analytics/page.tsx`

Updated dashboard API client:

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

## Verification Completed

Passed:

- Backend Prisma generate
- Backend Prisma schema validation
- Backend typecheck
- Backend production build
- Backend tests: 64/64 passed
- Widget typecheck
- Widget production build
- Dashboard targeted lint for changed analytics files
- Dashboard production build
- `git diff --check`

Notes:

- Full dashboard lint still has a pre-existing lint failure in `dashboard/src/app/(dashboard)/websites/[id]/page.tsx`, outside this sprint.
- Some commands required elevation because the Windows sandbox blocked generated file replacement or child-process spawning under `node_modules` and `.next`.

## Outcome

After this sprint, the system can answer analytics questions such as:

- How many visitors came today?
- How many opened chat?
- How many popups were shown?
- Which popup had the highest CTR?
- Which pages generate the most conversations?
- Which website performs best?
- How many AI responses were generated?
- How many conversations ended without engagement?

No chat behavior, popup behavior, lead capture, CRM, billing, or conversation persistence was implemented.
## Popup Pipeline Investigation - Manual Testing Follow-up

Added end-to-end popup trace logging across the decision path so every stage prints pass/fail state and the exact suppression reason when blocked.

Trace coverage added:

- Widget event collection
- Session context and event quality validation
- Behavior Engine output
- Intent Engine output
- AI Sales Brain decision, confidence, score, threshold, and suppression reason
- Popup eligibility
- Widget/client suppression rules
- Cooldown remaining
- Popup generation request/result
- Popup delivery to widget
- Widget rendering result

Files updated for tracing:

- `backend/src/intelligence/popupTrace.ts`
- `backend/src/services/perceptionService.ts`
- `backend/src/routes/events.ts`
- `widget/src/sensors/index.ts`
- `widget/src/core/orchestrator.ts`

Root causes found during manual testing:

1. Older idle events could keep the behavior vector's `Distracted` value above `0.5`, causing hard suppression even after later high-intent actions. The bad-moment rule now suppresses only when the dominant behavior is `Distracted`.
2. The popup pipeline could reach generation but fail response validation with `cta_not_allowed` because `GenerateLead` popups were producing natural booking/call CTAs such as strategy-call language. The `capture_lead` CTA allowlist now accepts safe chat/message/book/schedule/demo/call/consultation wording.

Regression coverage added:

- `responseValidation: accepts chat-style CTA language for lead capture`

Verification completed after fixes:

- Backend typecheck passed.
- Backend tests passed: 65/65.
- Widget typecheck passed.
- Widget build passed and rebuilt `backend/public/widget.js`.
- Backend restarted at `http://localhost:8787`.
- Dashboard dev server was already running at `http://localhost:3000`.

Manual verification result:

- Fresh browser session on `http://[::1]:8787/playground.html` generated normal visitor activity: pricing hover/clicks, demo click, form focus/type, and scroll.
- Backend trace session `26b2c2d2` reached:
  - behavior: `Ready`
  - intent: `BuyBook`, readiness `hot`
  - popup confidence: high/medium during successful decisions
  - suppression reason: `null` on the successful generation path
  - cooldown remaining: `0` before generation
  - popup generated: `true`
  - popup delivered: `true`
- Browser console confirmed widget delivery and rendering:
  - `stage=9_popup_delivery_to_widget artifact_received`
  - `popup_displayed`
  - `stage=10_widget_rendering`

Expected suppression was also verified:

- Idle-only browsing prints `suppressionReason: distracted`.
- Follow-up batches after a displayed popup print `popup_active`, `cooldown`, or `frequency_budget` as appropriate.

## Analytics Tenant Isolation Follow-up

Fixed a multi-tenant isolation bug where individual website analytics views could show organization-wide data.

Root cause:

- The dashboard Analytics page called summary and chart endpoints without passing the current `websiteId`.
- The backend summary endpoint accepted `websiteId` filters for most metrics, but `websitePerformance` still used a global organization aggregate even when a website filter was supplied.

Fixes:

- Added `dashboard/src/components/analytics-view.tsx` as a reusable analytics view that accepts an optional `websiteId`.
- Updated global `/analytics` to render unscoped organization analytics intentionally.
- Added an Analytics tab to `/websites/[id]` and made it pass the current website ID to every summary and chart request.
- Updated backend analytics endpoints to resolve and assert website ownership before applying a `websiteId` filter.
- Updated `websitePerformance` aggregation to filter by `websiteId` whenever a scoped website dashboard is requested.

Verified tenant boundaries:

- Widget analytics payloads carry the public `siteId`.
- Backend ingest resolves `siteId` to canonical `organizationId` and `websiteId`.
- `AnalyticsEvent`, `AnalyticsVisitor`, and `AnalyticsSession` are persisted with the resolved `websiteId`.
- Visitor metrics filter by `websiteId`.
- Conversation metrics filter by `websiteId`.
- Popup displayed/clicked/CTR metrics filter by `websiteId`.
- Chat opens/messages/AI response metrics filter by `websiteId`.
- Top Pages filter by `websiteId`.
- Top Popup Types filter by `websiteId`.
- Device Breakdown filters by `websiteId`.
- Daily Visitors, Daily Chats, Popup CTR, and Conversation Trend charts filter by `websiteId`.

Manual/local verification:

- Creovix website ID: `2c32cd33-3119-4c11-8d84-71325184020c`, site ID: `site_4e0d58ec4149`.
- Colour Trading website ID: `921a02c4-ecf3-4183-b57d-25ea38f7887f`, site ID: `site_f41dc8a91ef1`.
- Generated 9 public analytics events for each website through `/analytics/events` using the correct `siteId`.
- Persistence check found 18 verification events total: 9 stored under Creovix and 9 stored under Colour Trading.
- Stored `websiteId` mismatches: 0.
- Scoped dashboard API checks passed for both websites:
  - summary today metrics matched direct website-filtered DB calculations
  - top pages matched direct website-filtered DB calculations
  - top popup types matched direct website-filtered DB calculations
  - device breakdown matched direct website-filtered DB calculations
  - daily visitors chart matched direct website-filtered DB calculations
  - daily chats chart matched direct website-filtered DB calculations
  - popup CTR chart matched direct website-filtered DB calculations
  - conversation trend chart matched direct website-filtered DB calculations
- Leak checks passed:
  - Creovix dashboard did not contain the Colour Trading verification page or popup type.
  - Colour Trading dashboard did not contain the Creovix verification page or popup type.

## AI Decision Log Follow-up

Added an explainability layer for the popup decision pipeline so popup decisions are visible in Analytics instead of remaining a black box.

Design:

- The log uses the existing internal pipeline outputs from the Behavior Engine, Intent Engine, Sales Brain, popup strategy, LLM stage, response validation, and widget outcome analytics.
- It does not duplicate AI reasoning or introduce a new decision path.
- Writes are queued asynchronously through `enqueueAiDecisionLog` and `enqueueAiDecisionOutcomes`, so decision logging does not add blocking latency to popup generation, chat, RAG, crawler, or analytics ingestion.

Database added:

- `AiDecisionLog`
- Migration: `backend/prisma/migrations/20260708010100_add_ai_decision_log/migration.sql`

Backend files added/updated:

- `backend/src/analytics/decision-log.service.ts`
- `backend/src/analytics/analytics.routes.ts`
- `backend/src/routes/events.ts`
- `backend/prisma/schema.prisma`

Dashboard files added/updated:

- `dashboard/src/components/analytics-view.tsx`
- `dashboard/src/lib/api.ts`

Dashboard API:

- `GET /api/analytics/decision-log`

Supported filters:

- `websiteId`
- `decision`
- `popupType`
- `sessionId`
- `date`
- `search`
- `limit`

Dashboard fields shown:

- Timestamp
- Website
- Session ID
- Current page
- Behavior summary
- Intent summary
- Sales strategy
- Confidence score and band
- Decision
- Reason
- Popup generated
- Popup suppressed
- Suppression reason
- Generated popup type/title
- CTA type/text
- LLM used
- Validation passed
- Final outcome
- Popup displayed
- Popup clicked
- Popup dismissed
- Chat opened

Decision rows are newest first. Individual website analytics pages pass the current website ID, so decision logs are tenant-scoped just like the rest of analytics. The unscoped global Analytics page may still aggregate organization-wide decisions intentionally.

Verification script added:

- `backend/scripts/verify-ai-decision-log.ts`

Live verification completed with backend at `http://localhost:8787` and dashboard at `http://localhost:3000`.

Verification marker:

- `decision_log_1783448685921`

Verified websites:

- Creovix website ID: `2c32cd33-3119-4c11-8d84-71325184020c`, site ID: `site_4e0d58ec4149`
- Colour Trading website ID: `921a02c4-ecf3-4183-b57d-25ea38f7887f`, site ID: `site_f41dc8a91ef1`

Suppressed decision verified:

- Session: `decision_log_1783448685921_creovix_suppressed_session`
- Decision: `Suppressed`
- Behavior: `Browsing (11%), flat, settled`
- Intent: `Learn intent, cold readiness, conflicting signals`
- Confidence score: `0.3793`
- Suppression reason: `low_confidence`

Generated popup decision verified:

- Session: `decision_log_1783448685921_creovix_generated_session`
- Decision: `Popup Generated`
- Strategy: `ReducePriceAnxiety`
- Popup type: `pricing`
- CTA: `Discuss Pricing Options`
- LLM used: `true`
- Validation passed: `true`
- Widget outcomes recorded:
  - displayed: `true`
  - clicked: `true`
  - dismissed: `true`
  - chat opened: `true`
  - final outcome: `Chat Opened`

Decision-log tenant isolation verified:

- Colour Trading session: `decision_log_1783448685921_colour_suppressed_session`
- Colour Trading log stored under website ID `921a02c4-ecf3-4183-b57d-25ea38f7887f`
- Creovix decision-log API returned 2 marker rows.
- Colour Trading decision-log API returned 1 marker row.
- Cross-website decision leak count: 0.

Final checks:

- Backend typecheck passed.
- Dashboard typecheck passed.
- Backend tests passed: 65/65.
- End-to-end AI Decision Log verifier passed.

### AI Decision Log Download Export

Added a date-range download flow to the AI Decision Log dashboard section.

What changed:

- The dashboard now shows `From` and `To` date inputs inside AI Decision Log.
- `Download Log` exports all AI decision logs for the selected date range and current website scope.
- Website dashboards export only that website's decision logs.
- The global Analytics page can export all websites in the organization.
- The downloaded file is a readable `.txt` log, not a raw UI screenshot.
- Each exported decision includes timestamp, website, session, visitor, page, behavior, intent, strategy, confidence, decision, reason, popup details, CTA, LLM usage, validation result, and final widget outcomes.

Backend support:

- `GET /api/analytics/decision-log` now accepts `startDate`, `endDate`, and `export=1`.
- Normal dashboard reads remain capped for UI performance.
- Export reads allow up to 5000 rows while preserving organization and website tenant filters.

Verification:

- Backend typecheck passed.
- Dashboard typecheck passed.

### GenerateLead CTA Validation Follow-up

Investigated fresh `cta_not_allowed` suppressions in AI Decision Log for Colour Trading.

Findings:

- The new export was not stale. It contained fresh `GenerateLead` decisions with `CTA Type: capture_lead`, `LLM Used: Yes`, `Validation Passed: No`, and `Suppression Reason: cta_not_allowed`.
- Two CTA validation layers exist:
  - `validatePreLlmSafety` checks strategy-level CTA intent before the LLM call.
  - `validatePopupResponse` checks generated CTA text after the LLM call.
- The failing branch was the response validator: `validatePopupResponse -> ctaMatchesIntent`.
- Popup types do not use separate validators; they share `validatePopupResponse`, with expected popup type mapped by conversation strategy.
- The prompt was not cached, but it did not give enough concrete `capture_lead` CTA examples, so the model could produce valid lead CTAs outside the narrow regex list.
- Future rejected popups now log the generated title and CTA text instead of leaving those fields blank in AI Decision Log.

Fixes:

- Replaced narrow CTA pattern handling with centralized `CTA_RULES` containing both regexes and human-readable expected values.
- Expanded valid `capture_lead` CTA language to include request, claim, get, join, sign up, register, access, unlock, try, begin, connect, speak, send, reach, enquire/inquire, ask, check, find, show, guide, help, interested, yes, and continue patterns.
- Added validator diagnostics that print, for every `cta_not_allowed` rejection:
  - generated popup title
  - generated CTA text
  - generated CTA type
  - validation rule that failed
  - exact validator branch
  - expected allowed values
- Added prompt guidance with concrete `capture_lead` CTA examples such as `Request a Consultation`, `Claim Gift Code`, `Get Started`, `Join Now`, and `Access Details`.
- Updated AI Decision Log persistence to store rejected popup title/type/CTA when response validation fails.

Verification:

- Added regression test for 20 common `GenerateLead` + `capture_lead` CTA variants.
- Added `backend/scripts/verify-lead-cta-validation.ts`.
- Verification generated 20 lead popups through the safe popup pipeline.
- Result: `generatedLeadPopups: 20`, `ctaNotAllowedOccurrences: 0`.
- Targeted response validation tests passed: 13/13.
- Backend full test suite passed: 66/66.
- Backend typecheck passed.
- Dashboard typecheck passed.
