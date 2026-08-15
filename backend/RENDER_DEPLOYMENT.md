# Render Backend Deployment Guide

This backend is deployed as a Render Web Service with the repository root as its working directory. The widget and backend are built together during deployment.

## 1. Required Render Settings

- Service type: Web Service
- Environment: Node
- Root Directory: **blank** (repository root)
- Branch: your production branch
- Region: choose the same region as the database when possible
- Auto-Deploy: On Commit
- Health Check Path: `/health`

Render provides `PORT`; the server binds to `0.0.0.0` automatically.

Leave **Root Directory** blank. Render therefore executes the build and start commands from the repository root; do not set it to `backend` for this production configuration.

## 2. Build Command

```bash
cd widget && npm ci --include=dev && npm run build && cd ../backend && npm ci --include=dev && npm run build
```

This is the canonical production Build Command. Starting at the repository root, it:

1. Runs `cd widget`, installs the widget dependencies (including development dependencies needed to build), and builds the widget.
2. The widget build generates `backend/public/widget.js` from `widget/src/index.ts`.
3. Runs `cd ../backend`, installs backend dependencies. The backend `postinstall` generates Prisma Client.
4. Builds the backend TypeScript.

`backend/public/widget.js` is intentionally generated during deployment and remains Git-ignored. Do not commit it to Git. A fresh checkout can produce the widget bundle successfully with the canonical Build Command above.

## 3. Start Command

```bash
cd backend && npm start
```

This is the canonical production Start Command. The backend serves the generated widget bundle at `/widget.js`.

## 4. Required Environment Variables

Set these in Render > Environment:

- `NODE_ENV=production`
- `DATABASE_URL`
- `PRIMARY_LLM_PROVIDER=openai`
- `PRIMARY_LLM_MODEL=gpt-5-mini`
- `OPENAI_API_KEY`
- `FALLBACK_LLM_PROVIDER=gemini`
- `FALLBACK_LLM_MODEL=gemini-2.5-flash`
- `GEMINI_API_KEY`
- `SESSION_SECRET`
- `FRONTEND_URL`
- `DASHBOARD_ORIGIN`
- `WIDGET_BASE_URL`
- `CORS_ORIGIN`
- `KNOWLEDGE_STORAGE=r2`
- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`
- `R2_REGION=auto`

Recommended/optional:

- `GEMINI_MODEL=gemini-2.5-flash`
- `EMBEDDING_MODEL=gemini-embedding-001`
- `LANDING_PAGE_URL`
- `SESSION_TTL_DAYS=30`
- `RETRIEVAL_TOP_K=5`
- `RETRIEVAL_MIN_SCORE=0.5`
- `RETRIEVAL_MAX_CONTEXT_CHARS=9000`
- `CRAWL_MAX_PAGES=25`
- `CRAWL_CONCURRENCY=4`
- `CRAWL_TIMEOUT_MS=12000`
- `KNOWLEDGE_WORKER_CONCURRENCY=1` (durable Postgres job worker concurrency per backend instance)
- `KNOWLEDGE_WORKER_POLL_MS=2000`
- `KNOWLEDGE_BUILD_LEASE_MS=120000`
- `DEBUG_TRACE=false`

Production startup fails before binding a port if required configuration is missing or invalid. This includes `DATABASE_URL`, `SESSION_SECRET`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `FRONTEND_URL`, `DASHBOARD_ORIGIN`, `WIDGET_BASE_URL`, and `CORS_ORIGIN`. It also rejects a weak session secret, wildcard/invalid CORS origins, unsupported LLM providers, invalid storage modes, and incomplete R2 settings when `KNOWLEDGE_STORAGE=r2`. Errors name configuration keys only; they never print their values.

## 5. Prisma Migration Command

Run before the first production start and whenever migrations change:

```bash
cd backend && npm run prisma:migrate:deploy
```

On Render, run this from a one-off shell/job at the repository root after environment variables are configured.

## 6. Health Endpoint URL

```text
https://YOUR-BACKEND.onrender.com/health
```

The response is a liveness check: it remains HTTP 200 during temporary database or model-provider outages so Render does not restart a healthy process. It reports only non-sensitive configuration/readiness metadata—never secrets, connection strings, stack traces, filesystem paths, or Prisma internals.

## 7. Post-Deployment Verification Checklist

- `/health` returns HTTP 200 and `status: "ok"`.
- `/widget.js` returns JavaScript with no redirect or HTML fallback.
- Dashboard login/signup can set and read the secure session cookie.
- Dashboard API calls succeed from `DASHBOARD_ORIGIN`.
- Landing page API calls succeed only if its origin is included in `CORS_ORIGIN`.
- Customer widget origins are taken from active Website records and are allowed only for public, non-credentialed widget routes. Do not add them to the credentialed dashboard `CORS_ORIGIN` allowlist.
- `POST /chat` streams SSE responses without buffering.
- `POST /api/websites/:id/knowledge/build` streams SSE build events.
- Prisma migrations have been applied with `cd backend && npm run prisma:migrate:deploy`.
- Render logs show startup and shutdown lifecycle messages only, not prompts or raw model responses.

## Durable knowledge snapshots (Cloudflare R2)

Production RAG snapshots are complete private JSON artifacts in Cloudflare R2. Create a private bucket and an R2 API token with access limited to that bucket; configure the variables above only in Render. Never expose these credentials to the dashboard or widget.

R2 support is ready in code, but the private bucket and least-privilege credentials are deployment setup. This hardening change does not create a bucket, test credentials, or migrate existing local snapshots. Do not run the optional `knowledge:migrate-r2` utility as part of a normal deployment unless you have separately planned and approved that data migration.

`KNOWLEDGE_STORAGE=local` remains available for local development. Do not use it for a Render production service: Render filesystems are ephemeral.

## Notes

- Keep `DEBUG_TRACE=false` in production. Turning it on can log prompt, RAG, popup, and model trace details.
- Use a pooled database URL if your Postgres provider recommends it for web workloads.
- Render filesystems are ephemeral. Use R2 in production. `KNOWLEDGE_STORAGE=local` is retained for development and migration rollback only.
- The service handles graceful shutdown; allow Render to send its normal termination signal during deploys and maintenance rather than force-stopping the process.

