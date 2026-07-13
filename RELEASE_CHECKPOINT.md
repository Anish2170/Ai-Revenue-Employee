# Release Checkpoint

Project Version: v0.9.0-pre-production

## Completed Features

- Authentication
- Landing Page
- Guided Onboarding
- Knowledge Build
- Website Actions
- AI Chat
- Popup Engine
- Lead Capture
- Analytics
- AI Decision Log
- Conversations
- Widget

## Verification Status

- Backend typecheck: Passed (`npm run typecheck`)
- Backend build: Passed (`npm run build`)
- Frontend typecheck: Passed (`npm run typecheck`)
- Frontend build: Passed (`npm run build`)
- Widget typecheck: Passed (`npm run typecheck`)
- Widget build: Passed (`npm run build`)
- Prisma schema validation: Passed (`npx prisma validate`)
- Merge conflict scan: Passed; no unfinished conflict markers found.

## Completed Checkpoint Cleanup

- Gated widget startup/config/success logs behind the widget `debug` flag so they do not emit during normal production use.
- Added a dashboard `typecheck` npm script so frontend verification is reproducible.

## Known Limitations

- Knowledge snapshots currently stored on local filesystem.
- Cloudflare R2 migration is the next milestone.
- Dashboard currently uses the deprecated Next.js `middleware` convention; Next.js recommends migrating this file to `proxy` in a future maintenance task.

## Next Planned Task

Cloudflare R2 Migration

## Risk Assessment

Before public launch, verify:

- Production `DATABASE_URL`, `GEMINI_API_KEY`, `SESSION_SECRET`, `WIDGET_BASE_URL`, `FRONTEND_URL`, `DASHBOARD_ORIGIN`, and `CORS_ORIGIN` are configured on Render.
- Prisma migrations have been applied with `npm run prisma:migrate:deploy`.
- Knowledge snapshots are migrated away from ephemeral local storage before relying on production RAG data.
- `/health` returns a healthy status in the deployed environment.
- Dashboard auth cookies work over HTTPS with the deployed dashboard/backend origins.
- Widget `widget.js` serves correctly from the production backend URL.
- `/chat` and knowledge build SSE streams work through Render without buffering issues.
- Customer widget origins are explicitly included in production CORS configuration.
- Gemini quota, billing, and rate limits are sufficient for launch traffic.
- Lead capture, analytics, AI decision log, and conversation persistence are verified against the production database.

## Verification Commands

Backend:

```bash
npm run typecheck
npm run build
```

Frontend:

```bash
npm run typecheck
npm run build
```

Widget:

```bash
npm run typecheck
npm run build
```

Prisma:

```bash
npx prisma validate
```
