# Render Backend Deployment Guide

This backend is ready to deploy as a Render Web Service from the `backend` directory. Do not deploy from the repository root unless you adjust the commands to `cd backend` first.

## 1. Required Render Settings

- Service type: Web Service
- Environment: Node
- Root Directory: `backend`
- Branch: your production branch
- Region: choose the same region as the database when possible
- Auto Deploy: your preference
- Health Check Path: `/health`

Render provides `PORT`; the server binds to `0.0.0.0` automatically.

## 2. Build Command

```bash
npm ci --include=dev && npm run build
```

`npm ci --include=dev` keeps TypeScript and the Prisma CLI available during Render builds even when `NODE_ENV=production`; `postinstall` generates Prisma Client.

## 3. Start Command

```bash
npm start
```

## 4. Required Environment Variables

Set these in Render > Environment:

- `NODE_ENV=production`
- `DATABASE_URL`
- `GEMINI_API_KEY`
- `SESSION_SECRET`
- `FRONTEND_URL`
- `DASHBOARD_ORIGIN`
- `WIDGET_BASE_URL`
- `CORS_ORIGIN`

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
- `DEBUG_TRACE=false`

Production startup fails fast if `DATABASE_URL`, `GEMINI_API_KEY`, `SESSION_SECRET`, or `WIDGET_BASE_URL` is missing, if `SESSION_SECRET` is weak, or if `CORS_ORIGIN=*`.

## 5. Prisma Migration Command

Run before the first production start and whenever migrations change:

```bash
npm run prisma:migrate:deploy
```

On Render, run this from a one-off shell/job in the `backend` root after environment variables are configured.

## 6. Health Endpoint URL

```text
https://YOUR-BACKEND.onrender.com/health
```

The response reports database status, Gemini configuration, knowledge readiness, environment, version, and overall status. It does not expose secrets, connection strings, stack traces, or Prisma internals.

## 7. Post-Deployment Verification Checklist

- `/health` returns HTTP 200 and `status: "ok"`.
- `/widget.js` returns JavaScript with no redirect or HTML fallback.
- Dashboard login/signup can set and read the secure session cookie.
- Dashboard API calls succeed from `DASHBOARD_ORIGIN`.
- Landing page API calls succeed only if its origin is included in `CORS_ORIGIN`.
- Widget customer domains that need `/events`, `/engage`, `/chat`, or conversation routes are included in `CORS_ORIGIN`.
- `POST /chat` streams SSE responses without buffering.
- `POST /api/websites/:id/knowledge/build` streams SSE build events.
- Prisma migrations have been applied with `npm run prisma:migrate:deploy`.
- Render logs show startup and shutdown lifecycle messages only, not prompts or raw model responses.

## Notes

- Keep `DEBUG_TRACE=false` in production. Turning it on can log prompt, RAG, popup, and model trace details.
- Use a pooled database URL if your Postgres provider recommends it for web workloads.
- If knowledge snapshots are stored on the Render filesystem, they are ephemeral unless backed by a disk or external storage. Database records remain persistent, but local snapshot files may be lost on redeploy without persistent storage.

