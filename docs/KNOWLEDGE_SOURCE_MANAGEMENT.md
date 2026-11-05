# Knowledge source management

Implemented locally on 5 November 2026. Production deployment and the production database migration have not been run.

## What the dashboard now supports

- A source inventory with topic overview, short text previews, extracted-content review and individual indexed sections.
- Readiness, queued/running, failed, skipped, partial, disabled and removed states, with reasons and timestamps. The existing crawl manifest continues to show per-URL outcomes for the latest full build.
- PDF, UTF-8 TXT, Markdown, CSV and JSON upload, plus manually entered business notes.
- Editing uploaded/note text and titles, refreshing one source, enabling/disabling, removing and restoring sources.
- Refreshing a single same-origin page without crawling its links or sitemap or rebuilding other sources.
- Normal, Preferred and Highest source priorities. Detected matching-fact conflicts use the owner's explicit priority; equal priorities remain conflicting. Different plans/dates can be valid, so differences are presented for review rather than declared errors.
- A customer-question test using the same chat pipeline, showing the exact retrieved context captured for that answer. Inspection bypasses answer caching and creates no visitor conversation or lead.
- Optional daily/weekly checks of known enabled website pages. Scheduling defaults to off. A full crawl discovers new website URLs.

The overview is an extractive preview and topic inventory, not an AI certification that every website fact has been captured. Users can inspect the saved text directly.

## Persistence and retrieval behavior

`KnowledgeSource` stores per-source controls, durable pending work, extracted text and published embedded chunks in PostgreSQL. These records remain independent of immutable website snapshots, so full rebuilds retain uploads, notes and exclusions. Unchanged source sections reuse their embeddings.

The registry composes website snapshot content with the current source versions before chat/popup retrieval. A page refresh replaces that page's previous chunks; a later successful full crawl supersedes an older page refresh while preserving its enable/priority controls. Deduplicated aliases are filtered too, so disabling an alias cannot leave it as provenance. A removed source leaves a recoverable exclusion record that survives rebuilds and cold loads.

Queued/failed replacements retain their last published content. A new source becomes searchable only after successful parsing and embedding. Invalid files and incomplete page content are visibly failed. Source policies must be readable from the database; a policy read failure does not fall back to an old composition that could ignore a recent disable/remove operation.

Worker claims use revision numbers, lease tokens and expiry. Publication locks the website and source before checking the clock, so stale workers cannot overwrite later edits or publish after a lease expires during a row-lock wait. The worker checks the website's organization and current origin again before publication. Changes propagate across API instances through database reads.

Owner/admin roles can mutate sources and run answer tests. Source reads are scoped to the authenticated organization and website. Mutation requests use existing CSRF protection and bounded rate limits. Page fetches retain the existing public-network, redirect, same-origin and robots protections. Private uploads are not emitted as fabricated public website citation links.

## Limits

- 5 MB per upload; PDFs up to 150 pages and 200,000 extracted characters per source.
- PDFs require selectable text. OCR for scanned/image-only PDFs is not included; these receive an actionable failure.
- An individual text paragraph/semantic unit must fit within 8,000 characters; oversized units are rejected rather than silently truncated.
- Conflict review detects supported structural price, service-availability and refund statements. It is heuristic, does not cover every language or arbitrary contradiction, and does not decide which source is factually true.
- Page refresh uses the existing static HTML crawler. Failed/dynamic/restricted pages remain visible for review.
- Daily/weekly checks revisit known enabled pages; they do not discover new URLs until a full crawl.
- Answer preview checks knowledge without executing navigation actions or lead capture.

## Deployment

Use the normal backend/frontend release process, with the additive migration applied before the new server starts:

```powershell
cd backend
npm ci
npm run prisma:migrate:deploy
npm run build

cd ../dashboard
npm ci
npm run build
```

Migration: `backend/prisma/migrations/20261105120000_knowledge_sources/migration.sql`. It adds the source table and the website refresh setting. Existing websites default to manual refresh. The source worker starts with the API server; no external cron service is required. Tested on Node 22.19.0; the PDF dependency requires Node 20.16+ on the 20.x line, or Node 22.3+.

## Verification

- Backend full suite: **1,163 passed, 0 failed**. This suite includes fixtures and controlled HTTP tests; it is not a claim that all tests use PostgreSQL.
- Final source/publication regression run: **32 passed**. Chat/source regression run after context-inspection changes: **46 passed**; these overlap the full suite and are not additional unique tests.
- **14 real PostgreSQL/HTTP scenarios** passed against a newly initialized isolated local database, `127.0.0.1:55455/knowledge_sources_test`. All 19 migrations applied successfully there.
- Those real database checks cover authentication, CSRF, tenant isolation, role restrictions, text publication, priority-aware answers, actual PDF extraction, duplicate uploads, image-only/empty PDF failures, page replacement, failed-refresh retention, concurrent edits, lease expiry while blocked on a row lock, cold-load exclusions, and daily scheduling.
- Backend and dashboard production builds, TypeScript checks and Prisma schema validation passed. Lint for the new source component/API/type files passed. Repository-wide dashboard lint still reports pre-existing issues in other existing code, including the pre-existing state-setting effect in `knowledge-tab.tsx`.
- Chrome verified source-content review, creating a note through the dashboard, transition from queued to ready, and a preferred-source answer with its expanded evidence.

Test requests used synthetic content, controlled embeddings and controlled crawler transport. No paid generation/embedding calls, production crawls or production database writes were used for verification.

Evidence retained in `.tmp/knowledge-sources-20261105/verification.json`, `integration-final.log` and `browser-answer-proof.jpg`. The full backend run is in `.tmp/knowledge-sources-backend-tests-unrestricted.log`; the final dashboard build is in `.tmp/knowledge-sources-dashboard-build-final.log`.

The isolated verification script is `backend/scripts/knowledge-sources-verification.ts`. It refuses databases other than the exact local test target. Its `--serve` option exposes the synthetic source dashboard on loopback port 4347 for visual checks.

The temporary browser fixture and PostgreSQL server were stopped after verification. Only this task's newly created temporary database data directory was removed; reports, source and screenshot evidence were retained.
