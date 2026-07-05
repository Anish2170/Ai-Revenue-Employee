# Sprint 3 — Technical Handoff

> AI Revenue Employee · SaaS Foundation  
> Status: Backend complete. Dashboard (Next.js) not started.

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                        VISITOR BROWSER                              │
│  ┌──────────────────┐                   ┌─────────────────────────┐ │
│  │ Customer Website  │                   │ Dashboard (Next.js)     │ │
│  │ <script           │                   │ localhost:3001           │ │
│  │  data-site-id=".."│                   │ cookie: aire_session    │ │
│  │  src="/widget.js">│                   │ credentialed CORS       │ │
│  └──────┬───────────┘                   └──────────┬──────────────┘ │
└─────────┼──────────────────────────────────────────┼────────────────┘
          │ POST /engage {siteId, behaviour, session}│ /auth/* /api/*
          │ POST /chat   {siteId, messages}          │ (cookie auth)
          ▼                                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    EXPRESS BACKEND :8787                              │
│                                                                      │
│  PUBLIC ROUTES (no auth, siteId-scoped)                              │
│  ┌────────┐ ┌──────┐ ┌────────┐ ┌───────┐                          │
│  │/engage │ │/chat │ │/ingest │ │/debug │                          │
│  └───┬────┘ └──┬───┘ └───┬────┘ └───────┘                          │
│      │         │         │                                           │
│      ▼         ▼         ▼                                           │
│  ┌─────────────────────────────────┐                                 │
│  │ Tenant Resolver (siteId→ctx)    │ ◄── only when hasDatabase       │
│  └─────────────┬───────────────────┘                                 │
│                ▼                                                     │
│  ┌─────────────────────────────────┐                                 │
│  │ Services (engage/chat/ingest)   │                                 │
│  └─────────────┬───────────────────┘                                 │
│                ▼                                                     │
│  ┌────────────────────────┐  ┌────────────────────────┐             │
│  │ Context Provider       │  │ VectorStore Registry   │             │
│  │ (RAG + fallback)       │──│ (per-website stores)   │             │
│  └────────┬───────────────┘  └────────────────────────┘             │
│           ▼                                                          │
│  ┌────────────────────┐  ┌───────────────────────────┐              │
│  │ Prompt Builders    │  │ LLM Provider (Gemini)     │              │
│  │ engage-v5, chat-v2 │──│ generateStructured        │              │
│  └────────────────────┘  │ streamText, embed          │              │
│                          └───────────────────────────┘              │
│                                                                      │
│  PRIVATE ROUTES (requireAuth middleware, organizationId-scoped)       │
│  ┌──────────┐ ┌───────────┐ ┌──────────────┐ ┌────────┐ ┌────────┐│
│  │/auth/*   │ │/api/      │ │/api/websites/│ │widget  │ │knowl-  ││
│  │          │ │websites   │ │:id/instruct. │ │routes  │ │edge    ││
│  └──────────┘ └───────────┘ └──────────────┘ └────────┘ └────────┘│
│                                                                      │
│  ┌───────────────┐                                                   │
│  │ Neon Postgres  │ ◄── Prisma ORM, 11 models                       │
│  └───────────────┘                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

**Tenancy model:** Shared DB, shared schema, `organizationId` discriminator.  
**Ownership chain:** `Widget.siteId` → `Website.id` → `Organization.id`.  
**Two request classes:** Public (widget, siteId-scoped, no auth) and Private (dashboard, cookie-session + ownership assertion).

---

## 2. Project Structure

```
backend/
├── prisma/
│   └── schema.prisma              # 11 Prisma models
├── config/
│   └── business-instructions.json # Sprint 2 legacy, replaced by DB
├── data/
│   └── knowledge/                 # Per-website snapshot JSONs
│       └── <websiteId>.json
├── src/
│   ├── server.ts                  # Entrypoint. Mounts all routers.
│   ├── types.ts                   # Shared domain types
│   ├── config/
│   │   ├── index.ts               # Centralized env config
│   │   ├── policy.ts              # Engagement thresholds
│   │   ├── retrieval.ts           # topK, threshold, maxContextChars
│   │   └── crawl.ts               # [S3] Tracking-param denylist, path exclusions
│   ├── db/
│   │   └── prisma.ts              # [S3] PrismaClient singleton
│   ├── auth/
│   │   ├── password.ts            # [S3] bcrypt + SHA-256 token hashing
│   │   ├── auth.service.ts        # [S3] signup/login/logout/resolveSession
│   │   ├── auth.middleware.ts     # [S3] requireAuth → req.auth
│   │   └── auth.routes.ts        # [S3] /auth/* endpoints
│   ├── audit/
│   │   └── audit.service.ts       # [S3] Fire-and-forget audit logger
│   ├── tenant/
│   │   └── tenant.resolver.ts     # [S3] siteId → TenantContext (cached)
│   ├── websites/
│   │   ├── website.repository.ts  # [S3] Org-scoped Prisma CRUD
│   │   ├── website.service.ts     # [S3] Ownership assertion + audit
│   │   └── website.routes.ts      # [S3] /api/websites CRUD
│   ├── instructions/
│   │   ├── instruction.service.ts # [S3] DB-backed business instructions
│   │   └── instruction.routes.ts  # [S3] GET/PUT /api/websites/:id/instructions
│   ├── widgets/
│   │   ├── widget.service.ts      # [S3] siteId + publicKey generation
│   │   └── widget.routes.ts       # [S3] GET /api/websites/:id/widget
│   ├── knowledge/
│   │   ├── knowledge.service.ts   # [S3] SSE build orchestration + status
│   │   └── knowledge.routes.ts    # [S3] POST build (SSE), GET status/builds
│   ├── vectorstore/
│   │   ├── types.ts               # VectorStore port interface
│   │   ├── memoryStore.ts         # In-memory cosine impl
│   │   ├── persistence.ts         # [S3 modified] Per-website + legacy paths
│   │   ├── index.ts               # Dev-fallback singleton
│   │   └── registry.ts            # [S3] Per-website store map + LRU
│   ├── context/
│   │   ├── types.ts               # Chunk, ResolvedContext, KnowledgeSnapshot
│   │   ├── instructions.ts        # Sprint 2 JSON-file loader (fallback)
│   │   ├── staticContext.ts       # Sprint 1 hardcoded fallback
│   │   ├── provider.ts            # [S3 modified] Tenant-aware context
│   │   └── retriever.ts           # [S3 modified] Per-website store + maxContextChars
│   ├── services/
│   │   ├── engageService.ts       # [S3 modified] Accepts EngageOptions.tenant
│   │   ├── chatService.ts         # [S3 modified] Accepts tenant in input
│   │   └── ingestService.ts       # [S3 modified] Per-website + onPhase callback
│   ├── routes/
│   │   ├── engage.ts              # [S3 modified] Resolves tenant from siteId
│   │   ├── chat.ts                # [S3 modified] Resolves tenant from siteId
│   │   ├── ingest.ts              # Legacy dev ingest endpoint
│   │   └── debug.ts               # Dev-only /debug/rag
│   ├── crawler/
│   │   ├── crawler.ts             # BFS same-origin crawler
│   │   ├── extract.ts             # HTML→text via cheerio
│   │   └── links.ts               # [S3 modified] URL canonicalization + path exclusions
│   ├── chunking/
│   │   └── chunker.ts             # ~500-800 word chunks
│   ├── embeddings/
│   │   └── embedder.ts            # embedChunks (document) + embedQuery (query)
│   ├── llm/
│   │   ├── index.ts               # Facade: generateDecision, streamChat, embedTexts
│   │   └── provider/
│   │       ├── types.ts           # LLMProvider port
│   │       └── gemini.ts          # Gemini adapter
│   ├── prompts/
│   │   ├── shared.ts              # renderKnowledge, renderInstructions, renderSiteLinks
│   │   ├── engagePromptBuilder.ts # engage-v5
│   │   ├── chatPromptBuilder.ts   # chat-v2
│   │   └── registry.ts            # Active builder registry
│   ├── behaviour/
│   │   └── summarizer.ts          # Deterministic NL behaviour summary
│   ├── rules/
│   │   └── rulesEngine.ts         # Pre/post-LLM gates
│   ├── validation/
│   │   ├── engageSchema.ts        # Zod + JSON Schema for LLM output
│   │   ├── requestSchemas.ts      # [S3 modified] Added siteId field
│   │   └── responseValidator.ts   # Sanitize + CTA allowlist
│   └── middleware/
│       ├── cors.ts                # [S3 modified] Credentialed CORS for dashboard
│       ├── errorHandler.ts        # Central 404 + error handler
│       └── validate.ts            # Zod body-validation factory
widget/                            # UNCHANGED since Sprint 1
├── src/
│   ├── index.ts                   # Bootstrap
│   ├── config/index.ts            # data-site-id, data-backend
│   ├── tracker/{buffer,events,state}.ts
│   ├── session/state.ts
│   ├── api/client.ts              # postEngage, streamChat (sends siteId)
│   ├── core/orchestrator.ts       # State machine
│   ├── ui/{root,styles}.ts
│   ├── popup/popup.ts
│   ├── chat/chat.ts
│   └── types.ts
```

---

## 3. Module Dependency Graph

### Sprint 3 New Modules (Critical Path)

```
server.ts
 ├── config/index.ts
 ├── middleware/cors.ts ──► config/index.ts
 ├── routes/engage.ts ──► tenant/tenant.resolver.ts ──► db/prisma.ts
 │                    ──► services/engageService.ts
 │                        ├── context/provider.ts ──► context/retriever.ts
 │                        │                       ──► vectorstore/registry.ts
 │                        │                       ──► vectorstore/index.ts (fallback)
 │                        ├── rules/rulesEngine.ts
 │                        └── llm/index.ts
 ├── routes/chat.ts ──► tenant/tenant.resolver.ts
 │                  ──► services/chatService.ts ──► context/provider.ts
 ├── auth/auth.routes.ts ──► auth/auth.service.ts ──► auth/password.ts
 │                       ──► auth/auth.middleware.ts   ──► db/prisma.ts
 ├── websites/website.routes.ts ──► websites/website.service.ts
 │                              ──► websites/website.repository.ts ──► db/prisma.ts
 ├── instructions/instruction.routes.ts ──► instructions/instruction.service.ts
 │                                          ──► db/prisma.ts
 ├── widgets/widget.routes.ts ──► widgets/widget.service.ts ──► db/prisma.ts
 ├── knowledge/knowledge.routes.ts ──► knowledge/knowledge.service.ts
 │                                    ├── services/ingestService.ts
 │                                    ├── db/prisma.ts
 │                                    └── audit/audit.service.ts
 └── vectorstore/index.ts (singleton boot)
```

### VectorStore Dependency Chain

```
vectorstore/registry.ts
 ├── vectorstore/memoryStore.ts (creates MemoryVectorStore per website)
 ├── vectorstore/persistence.ts (loadSnapshotFile / saveSnapshotFile)
 ├── vectorstore/types.ts (VectorStore interface)
 ├── context/types.ts (KnowledgeSnapshot, EmbeddedChunk)
 └── config/index.ts (embeddingModel, knowledgeDir)

vectorstore/index.ts (dev singleton)
 ├── vectorstore/memoryStore.ts
 ├── vectorstore/persistence.ts (loadSnapshot / saveSnapshot → legacySnapshotPath)
 └── config/index.ts
```

### Tenant Resolution Chain

```
tenant/tenant.resolver.ts
 ├── db/prisma.ts
 │   └── Widget → Website (+ instruction) → Organization
 └── config/index.ts (hasDatabase)
```

### Modules That Must Not Be Modified Without Checking Dependents

| Module | Dependents |
|--------|-----------|
| `context/types.ts` | All RAG, vectorstore, context, prompts, services, debug |
| `types.ts` (root) | All routes, services, prompts, rules, validation, widget |
| `vectorstore/types.ts` | memoryStore, index, registry, retriever |
| `config/index.ts` | Nearly everything |
| `db/prisma.ts` | All S3 modules |
| `auth/auth.middleware.ts` | All private routes |
| `websites/website.service.ts` | instructions, widgets, knowledge (assertWebsiteOwnership) |
| `validation/requestSchemas.ts` | routes/engage, routes/chat |
| `validation/engageSchema.ts` | responseValidator, engagePromptBuilder, llm/index |

### Reusable Modules (No Tenant/Business Logic)

- `auth/password.ts` — Pure crypto utilities
- `audit/audit.service.ts` — Generic audit logger
- `middleware/validate.ts` — Zod validation factory
- `vectorstore/memoryStore.ts` — Standalone cosine store
- `vectorstore/types.ts` — Provider-agnostic port
- `llm/provider/types.ts` — Provider-agnostic LLM port
- `crawler/`, `chunking/`, `embeddings/` — Pure data pipeline, no tenant coupling

---

## 4. Request Lifecycles

### 4.1 Widget Engage Request

```
Widget                    Backend
  │                         │
  │ POST /engage            │
  │ {siteId, behaviour,     │
  │  session}                │
  │ ───────────────────────► │
  │                         │ 1. Zod validate body (requestSchemas)
  │                         │ 2. if (siteId && hasDatabase):
  │                         │      resolveTenant(siteId) → TenantContext
  │                         │        Widget → Website → Organization
  │                         │        cache (5min TTL)
  │                         │        fire-and-forget: widget.lastRequestAt++
  │                         │    else: tenant = undefined (dev fallback)
  │                         │ 3. evaluateEngagement(behaviour, session, {tenant})
  │                         │    a. shouldEvaluate() — pre-LLM gate
  │                         │       cooldown, frequency cap, eligibility
  │                         │    b. if !proceed → {showPopup: false}
  │                         │    c. getBusinessContext({query, behaviour, tenant})
  │                         │       → resolveStore(websiteId) or global singleton
  │                         │       → retrieve(query, websiteId)
  │                         │         embed(query, 'query')
  │                         │         store.search(topK)
  │                         │         filter(threshold)
  │                         │         enforce(maxContextChars)
  │                         │       → if chunks: source='rag'
  │                         │       → else: buildFallback() source='fallback'
  │                         │    d. summarize(behaviour) — deterministic NL
  │                         │    e. engagePromptBuilder.build(context,...)
  │                         │    f. generateDecision(system, user, schema)
  │                         │       → Gemini generateStructured → zod parse
  │                         │    g. validateEngageDecision(raw, allowedUrls, page)
  │                         │       sanitize text, clamp confidence, CTA allowlist
  │                         │    h. finalizeDecision() — post-LLM gate
  │                         │       confidence floor (0.6), dedup
  │                         │ 4. attach debug trace (if !production)
  │ ◄─────────────────────  │ 5. res.json(decision)
  │ {showPopup, message,    │
  │  ctaLabel, ctaUrl,      │
  │  intent, confidence}    │
```

### 4.2 Widget Chat Request

```
Widget                    Backend
  │ POST /chat              │
  │ {siteId, messages,      │
  │  behaviour}             │
  │ ───────────────────────► │
  │                         │ 1. Zod validate
  │                         │ 2. Resolve tenant (same as engage)
  │                         │ 3. streamChatReply({messages, behaviour, tenant})
  │                         │    a. Lift leading assistant messages (Gemini requirement)
  │                         │    b. getBusinessContext({query: lastUserMsg, tenant})
  │                         │    c. chatPromptBuilder.build(context, messages)
  │                         │    d. streamChat({system, messages})
  │                         │       → Gemini streamText
  │ ◄─ SSE stream ─────── │ 4. For each token: data: {"token":"..."}
  │ data: [DONE]            │ 5. Terminal sentinel
```

### 4.3 Authentication Flow

```
Dashboard                 Backend
  │ POST /auth/signup       │
  │ {email, password, name} │
  │ ───────────────────────►│
  │                         │ 1. Zod validate
  │                         │ 2. Check email uniqueness
  │                         │ 3. Transaction:
  │                         │    User.create(bcrypt(password))
  │                         │    Organization.create(slug)
  │                         │    OrganizationMember.create(OWNER)
  │                         │ 4. Session.create(tokenHash=SHA256(token))
  │                         │ 5. AuditLog
  │ ◄──────────────────────│ 6. Set-Cookie: aire_session=<raw_token>
  │ {user, organization}    │    httpOnly, Secure(prod), SameSite
  │                         │
  │ GET /auth/me            │
  │ Cookie: aire_session    │
  │ ───────────────────────►│
  │                         │ requireAuth middleware:
  │                         │   cookie → resolveSession(SHA256) → Session row
  │                         │   check: not revoked, not expired
  │                         │   req.auth = {userId, organizationId}
  │ ◄──────────────────────│ {user, organization}
  │                         │
  │ POST /auth/logout       │
  │ ───────────────────────►│ Session.revokedAt = now()
  │ ◄──────────────────────│ 204, clearCookie
```

### 4.4 Tenant Resolution Flow

```
resolveTenant(siteId)
  │
  ├─► Cache hit (TTL < 5min)? → return cached TenantContext
  │
  └─► Cache miss:
      prisma.widget.findUnique({siteId})
        include: website { include: organization, instruction }
      │
      ├─ widget == null || website.deletedAt → TenantNotFoundError (404)
      ├─ widget.status == DISABLED → TenantDisabledError (403)
      │
      └─► Build TenantContext:
          {organizationId, websiteId, siteId, websiteUrl, instructions}
          instructions from DB BusinessInstruction or defaults
          │
          ├─ Cache.set(siteId, tenant, TTL=5min)
          └─ Fire-and-forget: widget.requestCount++, lastRequestAt=now
```

### 4.5 Knowledge Build Flow (SSE)

```
Dashboard                 Backend
  │ POST /api/websites/    │
  │   :id/knowledge/build  │
  │ {url}                  │
  │ Cookie: aire_session   │
  │ ───────────────────────►│
  │                         │ 1. requireAuth
  │                         │ 2. assertWebsiteOwnership
  │                         │ 3. KnowledgeBuild.create(RUNNING)
  │                         │ 4. Start async ingest pipeline:
  │ ◄── SSE ──────────────│    event: build:start {buildId}
  │                         │
  │                         │    Phase: crawling
  │ ◄── SSE ──────────────│    event: build:phase {phase:"crawling"}
  │                         │      crawl(url) → pages[]
  │ ◄── SSE ──────────────│    event: build:phase {phase:"crawling", pages:N}
  │                         │
  │                         │    Phase: chunking
  │ ◄── SSE ──────────────│    event: build:phase {phase:"chunking"}
  │                         │      chunkPages(pages) → chunks[]
  │                         │
  │                         │    Phase: embedding
  │ ◄── SSE ──────────────│    event: build:phase {phase:"embedding"}
  │                         │      embedChunks(chunks) → embedded[]
  │                         │
  │                         │    Phase: indexing
  │ ◄── SSE ──────────────│    event: build:phase {phase:"indexing"}
  │                         │      invalidateWebsiteStore(websiteId)
  │                         │      getWebsiteStore(websiteId).indexDocuments()
  │                         │
  │                         │    Phase: saving
  │ ◄── SSE ──────────────│    event: build:phase {phase:"saving"}
  │                         │      persistWebsiteSnapshot(websiteId)
  │                         │      KnowledgeSnapshot.create(READY)
  │                         │      KnowledgeBuild.update(SUCCESS)
  │                         │      AuditLog
  │ ◄── SSE ──────────────│    event: build:complete {pages, chunks, durationMs}
  │ ◄── SSE ──────────────│    event: build:done {buildId}
  │                         │
  │                         │    On error at any phase:
  │ ◄── SSE ──────────────│    event: build:error {error}
  │                         │      KnowledgeBuild.update(FAILED)
```

---

## 5. Database Schema

### Entity-Relationship Diagram

```
User ◄──────── OrganizationMember ────────► Organization
 │                                              │
 ├── Session ◄──────────────────────────────────┤
 ├── AuditLog ◄─────────────────────────────────┤
 │                                              │
 │                                         Website
 │                                          │  │  │
 │                                          │  │  └── Widget (1:1)
 │                                          │  │       └── siteId (unique, public)
 │                                          │  │       └── widgetPublicKey (unique)
 │                                          │  │
 │                                          │  └── BusinessInstruction (1:1)
 │                                          │
 │                                     ┌────┴────┐
 │                              KnowledgeSnapshot  KnowledgeBuild
 │                              (artifact)         (event log)
 │
 └── PasswordResetToken (stubbed)
```

### Prisma Models Summary

| Model | Key Fields | Indexes | Notes |
|-------|-----------|---------|-------|
| `User` | email (unique), passwordHash?, name | email | Soft-delete ready |
| `Organization` | name, slug (unique) | — | Tenant boundary |
| `OrganizationMember` | organizationId, userId, role (OWNER/ADMIN/MEMBER) | @@unique([orgId, userId]), userId | Join table |
| `Session` | userId, organizationId, tokenHash (unique), expiresAt, revokedAt? | userId, expiresAt | Raw token only in cookie |
| `PasswordResetToken` | userId, tokenHash (unique), expiresAt, usedAt? | userId | Stubbed (501) |
| `Website` | organizationId, name, url, industry?, primaryLanguage, deletedAt? | organizationId | Soft-delete |
| `BusinessInstruction` | websiteId (unique 1:1), businessName, tone, language, alwaysBookDemo, avoidDiscounts, allowedLinks (JSON), supportEmail? | — | Replaces JSON file |
| `Widget` | websiteId (unique 1:1), siteId (unique), widgetPublicKey (unique), status (ACTIVE/DISABLED), requestCount | siteId | Public identity |
| `KnowledgeSnapshot` | websiteId, organizationId, version, embeddingModel, dimensions, pagesCrawled, chunkCount, sourceUrl, status (BUILDING/READY/FAILED), storageKey | [websiteId, version] | Artifact metadata |
| `KnowledgeBuild` | websiteId, organizationId, snapshotId?, status (RUNNING/SUCCESS/FAILED), currentPhase?, pages?, chunks?, error? | [websiteId, startedAt] | Append-only event log |
| `AuditLog` | organizationId?, userId?, action, targetType?, targetId?, metadata (JSON), ip? | [organizationId, createdAt] | Fire-and-forget |

### Enums

```
MemberRole:    OWNER | ADMIN | MEMBER
WidgetStatus:  ACTIVE | DISABLED
SnapshotStatus: BUILDING | READY | FAILED
BuildStatus:   RUNNING | SUCCESS | FAILED
```

---

## 6. Layer-by-Layer Reference

### 6.1 Authentication & Session

| File | Responsibility |
|------|---------------|
| `auth/password.ts` | `hashPassword` (bcrypt 12), `verifyPassword`, `generateToken` (randomBytes base64url), `hashToken` (SHA-256) |
| `auth/auth.service.ts` | `signup()` — User+Org+Member tx, returns raw token. `login()` — constant-time failure. `logout()` — revoke. `resolveSession()` — token→auth context. `AuthError` class. |
| `auth/auth.middleware.ts` | `requireAuth` — reads `aire_session` cookie → `resolveSession()` → `req.auth = {userId, organizationId}`. Augments Express.Request globally. |
| `auth/auth.routes.ts` | POST `/auth/signup` (201+cookie), POST `/auth/login` (200+cookie), POST `/auth/logout` (204+clearCookie), GET `/auth/me` (requireAuth). Cookie: httpOnly, Secure(prod), SameSite(none:prod/lax:dev). `/auth/forgot` + `/auth/reset` → 501. |

### 6.2 Tenant Resolution

| File | Responsibility |
|------|---------------|
| `tenant/tenant.resolver.ts` | `resolveTenant(siteId)` → `TenantContext{organizationId, websiteId, siteId, websiteUrl, instructions}`. 5-min TTL cache (Map). Throws `TenantNotFoundError` (404) or `TenantDisabledError` (403). Fire-and-forget widget stats update. `invalidateTenantCache(siteId?)`. |

### 6.3 Website CRUD

| File | Responsibility |
|------|---------------|
| `websites/website.repository.ts` | Org-scoped Prisma queries. Every function takes `organizationId` — isolation boundary. `listWebsites`, `getWebsite`, `createWebsite`, `updateWebsite` (updateMany for WHERE scope), `softDeleteWebsite`. |
| `websites/website.service.ts` | `assertWebsiteOwnership(orgId, websiteId)` — throws `OwnershipError(404)`. Delegates to repo, adds audit logging. |
| `websites/website.routes.ts` | GET/POST `/api/websites`, GET/PATCH/DELETE `/api/websites/:id`. All `requireAuth`. |

### 6.4 Business Instructions

| File | Responsibility |
|------|---------------|
| `instructions/instruction.service.ts` | `getOrCreateInstructions(orgId, websiteId)` — auto-creates with defaults on first access. `updateInstructions(orgId, userId, websiteId, data)` — Prisma upsert + audit. |
| `instructions/instruction.routes.ts` | GET/PUT `/api/websites/:id/instructions`. Zod schema validates update body. |
| `context/instructions.ts` | Sprint 2 legacy: loads `config/business-instructions.json`. Used as fallback when no DB. |

### 6.5 Widget Identity

| File | Responsibility |
|------|---------------|
| `widgets/widget.service.ts` | `getOrCreateWidget(orgId, websiteId)` — generates `site_<12hex>` siteId + `pk_<32b64url>` widgetPublicKey on first access. `buildScriptSnippet(siteId)`. `getWidgetView()`. |
| `widgets/widget.routes.ts` | GET `/api/websites/:id/widget`. |

### 6.6 Knowledge Build

| File | Responsibility |
|------|---------------|
| `knowledge/knowledge.service.ts` | `startBuild(orgId, websiteId, url, userId)` → `{buildId, events: AsyncIterable<BuildPhaseEvent>}`. Creates KnowledgeBuild(RUNNING), runs ingest with `onPhase` callback, creates KnowledgeSnapshot on success, updates build status. `getKnowledgeStatus(websiteId)` — latest snapshot + last build. `listBuilds(websiteId, limit)`. |
| `knowledge/knowledge.routes.ts` | POST `/api/websites/:id/knowledge/build` (SSE stream), GET `../status`, GET `../builds`. |

### 6.7 VectorStore Registry

| File | Responsibility |
|------|---------------|
| `vectorstore/registry.ts` | Per-website `MemoryVectorStore` instances. `getWebsiteStore(websiteId)` — lazy-load from `data/knowledge/<websiteId>.json`, LRU eviction at MAX_CACHED_STORES (default 20). `persistWebsiteSnapshot()`, `invalidateWebsiteStore()`, `knowledgeReadyForWebsite()`, `getWebsiteMeta()`. |
| `vectorstore/index.ts` | Dev-fallback singleton. `loadOnBoot()` from legacy path. `getVectorStore()`, `knowledgeReady()`, `persistSnapshot()`. |
| `vectorstore/persistence.ts` | `websiteSnapshotPath(websiteId)` → `data/knowledge/<id>.json`. `legacySnapshotPath()` → `data/knowledge-index.json`. Generic `loadSnapshotFile(path)`, `saveSnapshotFile(path, snap)`. Legacy API preserved for singleton. |

### 6.8 Context Provider & Retriever

| File | Responsibility |
|------|---------------|
| `context/provider.ts` | `getBusinessContext({query, behaviour, tenant?})`. When `tenant` present: uses per-website store + tenant instructions. When absent: dev singleton + JSON instructions. Falls back to `staticContext.ts` pseudo-chunks when RAG unavailable. |
| `context/retriever.ts` | `retrieve(query, websiteId?)`. Resolves store via registry or singleton. Embeds query, searches, applies threshold + `maxContextChars` budget (breaks when budget exhausted). `buildBehaviourQuery(behaviour)`. |

### 6.9 Ingestion Service

| File | Responsibility |
|------|---------------|
| `services/ingestService.ts` | `ingest(url, opts?)`. Pipeline: crawl → chunk → embed → index → persist. `opts.websiteId` → per-website store (registry). `opts.onPhase(phase, detail)` → SSE progress callback. `opts.language` override. Without opts: dev singleton path. |

### 6.10 Engage & Chat Services

| File | Responsibility |
|------|---------------|
| `services/engageService.ts` | `evaluateEngagement(behaviour, session, opts?)`. `opts.tenant` passed through to `getBusinessContext()`. Full pipeline unchanged: pre-gate → context → summarize → prompt → LLM → validate → post-gate. |
| `services/chatService.ts` | `streamChatReply({messages, behaviour, tenant?})`. `tenant` passed through to `getBusinessContext()`. Opener lifting and Gemini history fix unchanged. |

### 6.11 Crawler Refinements

| File | Responsibility |
|------|---------------|
| `config/crawl.ts` | `TRACKING_PARAM_DENYLIST` (utm_*, fbclid, gclid, etc.). `PATH_EXCLUSION_PATTERNS` (admin, login, cart, api, etc.). `isExcludedPath(url)`. |
| `crawler/links.ts` | `normalizeUrl()` now strips tracking params, sorts remaining params. `isCrawlablePath()` now checks `isExcludedPath()`. |

### 6.12 Middleware

| File | Responsibility |
|------|---------------|
| `middleware/cors.ts` | Dynamic origin check. Dashboard origin → `credentials: true`. Widget origins → permissive (configurable). Methods: GET/POST/PUT/PATCH/DELETE/OPTIONS. |
| `middleware/validate.ts` | `validateBody(schema)` — Zod parse, 400 on failure with field errors. |
| `middleware/errorHandler.ts` | `notFound` (404), `errorHandler` (500, stack in dev). |

---

## 7. API Endpoints

### Public (Widget — No Auth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/engage` | `{siteId?, behaviour, session}` | `EngageDecision` |
| POST | `/chat` | `{siteId?, messages, behaviour?}` | SSE: `{token}` / `[DONE]` |
| POST | `/ingest` | `{url}` | `IngestResult` |
| GET | `/health` | — | `{ok, llm, database, model, ...}` |
| GET | `/debug/rag` | — | Dev-only: chunks, stats |

### Auth

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/auth/signup` | `{email, password, name, organizationName?}` | 201 + cookie, `{user, organization}` |
| POST | `/auth/login` | `{email, password}` | 200 + cookie, `{user, organization}` |
| POST | `/auth/logout` | — | 204, clear cookie |
| GET | `/auth/me` | — (cookie) | `{user, organization}` |
| POST | `/auth/forgot` | — | 501 |
| POST | `/auth/reset` | — | 501 |

### Private (Dashboard — requireAuth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/websites` | — | `Website[]` |
| POST | `/api/websites` | `{name, url, industry?, ...}` | 201, `Website` |
| GET | `/api/websites/:id` | — | `Website` |
| PATCH | `/api/websites/:id` | `{name?, url?, ...}` | `Website` |
| DELETE | `/api/websites/:id` | — | 204 |
| GET | `/api/websites/:id/instructions` | — | `BusinessInstruction` |
| PUT | `/api/websites/:id/instructions` | `{businessName?, tone?, ...}` | `BusinessInstruction` |
| GET | `/api/websites/:id/widget` | — | `{siteId, scriptSnippet, ...}` |
| POST | `/api/websites/:id/knowledge/build` | `{url}` | SSE: build:phase/complete/error |
| GET | `/api/websites/:id/knowledge/status` | — | `{hasKnowledge, snapshot?, lastBuild?}` |
| GET | `/api/websites/:id/knowledge/builds` | — | `KnowledgeBuild[]` |

---

## 8. Important Interfaces & Types

### Domain Types (`types.ts`)

```ts
VisitorBehaviour { page, pageTitle, timeOnPage, scrollDepth, mouseInactive,
                   clickedElements, formInteracted, viewport, exitIntent }
SessionState     { popupShown, lastEngageAt, engageCount, dismissed }
EngageDecision   { showPopup, message?, ctaLabel?, ctaUrl?, intent?, confidence?, debug? }
DecisionTrace    { ruleMatched, llmCalled, reason, promptVersion?, knowledgeSource?,
                   retrievalScores?, processingTimeMs }
ChatMessage      { role: 'user'|'assistant', content }
SiteLink         { label, url }
BusinessFAQ      { q, a }
BusinessContext  { name, description, positioning, services[], pricingSummary,
                   faqs[], siteLinks[], contact }
```

### Context Types (`context/types.ts`)

```ts
PageType          = 'home'|'about'|'services'|'pricing'|'faq'|'contact'|'blog'|'case-study'|'other'
ChunkMetadata     { id, page, url, pageType, section, heading, title, language, hash, lastCrawled }
Chunk             extends ChunkMetadata { content }
EmbeddedChunk     extends Chunk { embedding: number[] }
RetrievedChunk    extends ChunkMetadata { content, score }
BusinessInstructions { businessName, tone, alwaysBookDemo, avoidDiscounts, language }
ResolvedContext   { business, instructions, chunks, siteLinks, source:'rag'|'fallback', scores }
KnowledgeSnapshot { version:1, embeddingModel, dimensions, createdAt, sourceUrl, siteLinks, pages, documents }
```

### Sprint 3 Types

```ts
// tenant/tenant.resolver.ts
TenantContext { organizationId, websiteId, siteId, websiteUrl, instructions: BusinessInstructions }

// auth/auth.middleware.ts
AuthContext { userId, organizationId }  // → req.auth

// auth/auth.service.ts
AuthResult { token, user:{id,email,name}, organization:{id,name,slug} }

// knowledge/knowledge.service.ts
BuildPhaseEvent { phase: IngestPhase, detail?: Record<string,unknown> }

// services/ingestService.ts
IngestPhase = 'crawling' | 'chunking' | 'embedding' | 'indexing' | 'saving'
IngestOptions { websiteId?, organizationId?, language?, onPhase? }

// vectorstore/registry.ts
LoadedMeta { sourceUrl, siteLinks, pages[], createdAt, embeddingModel }
```

---

## 9. Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8787` | Backend server port |
| `NODE_ENV` | `development` | Environment mode |
| `GEMINI_API_KEY` | _(empty)_ | LLM provider key |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Chat/engage model |
| `EMBEDDING_MODEL` | `gemini-embedding-001` | RAG embedding model |
| `DATABASE_URL` | _(empty)_ | Neon Postgres connection string |
| `SESSION_SECRET` | `dev-insecure-session-secret` | _(unused currently, reserved)_ |
| `SESSION_TTL_DAYS` | `30` | Session expiry |
| `CORS_ORIGIN` | `*` | Widget CORS (any origin) |
| `DASHBOARD_ORIGIN` | `http://localhost:3001` | Credentialed CORS for dashboard |
| `WIDGET_BASE_URL` | `http://localhost:8787` | Used in generated snippet |
| `KNOWLEDGE_DIR` | `data/knowledge` | Per-website snapshot directory |
| `KNOWLEDGE_SNAPSHOT_PATH` | `data/knowledge-index.json` | Legacy singleton path |
| `CRAWL_MAX_PAGES` | `25` | Max pages per crawl |
| `CRAWL_CONCURRENCY` | `4` | Concurrent fetch limit |
| `CRAWL_TIMEOUT_MS` | `12000` | Per-page fetch timeout |
| `RETRIEVAL_TOP_K` | `5` | Vector search top-K |
| `RETRIEVAL_MIN_SCORE` | `0.5` | Cosine similarity threshold |
| `RETRIEVAL_MAX_CONTEXT_CHARS` | `9000` | Max chunk chars in prompt |
| `MAX_CACHED_STORES` | `20` | VectorStore LRU cache size |
| `DEBUG_TRACE` | `!(production)` | Attach debug trace to /engage |

---

## 10. Configuration Files

| File | Purpose |
|------|---------|
| `backend/prisma/schema.prisma` | Database schema (11 models) |
| `backend/tsconfig.json` | TypeScript config (ESNext, NodeNext, strict) |
| `backend/package.json` | Dependencies, scripts (prisma:generate/migrate/studio) |
| `backend/.env` | Runtime env vars |
| `backend/.env.example` | Documented env template |
| `backend/config/business-instructions.json` | Sprint 2 legacy instructions |

---

## 11. Extension Points

| Point | Mechanism | Notes |
|-------|-----------|-------|
| LLM Provider | `llm/provider/types.ts` port | Implement `generateStructured`, `streamText`, `embed` |
| VectorStore | `vectorstore/types.ts` port | Replace `MemoryVectorStore` with pgvector/Pinecone |
| Auth (social login) | `User.passwordHash` is nullable | Add OAuth provider, issue session same way |
| Password reset | Routes stubbed at 501 | PasswordResetToken model ready |
| Teams/Roles | `MemberRole` enum, `OrganizationMember` | Role-based middleware not implemented |
| Widget verification | `Widget.widgetPublicKey` | Origin-signed requests (not implemented) |
| Incremental crawl | `ChunkMetadata.hash`, `KnowledgeSnapshot.pages[].contentHash` | Skip unchanged pages on re-crawl |
| Multi-language | `ChunkMetadata.language`, `Website.primaryLanguage` | Per-chunk language detection future |
| Snapshot storage | `KnowledgeSnapshot.storageKey` | Move from JSON files to S3/R2 |

---

## 12. Remaining TODOs

- [ ] Next.js dashboard (Sprint 3, Task 3): auth pages, website CRUD, instructions editor, widget install, KB build UI with SSE progress, overview
- [ ] Run `prisma migrate dev` against Neon (needs user's `DATABASE_URL`)
- [ ] Generate Prisma client (`npx prisma generate`)
- [ ] Full integration test: signup → create website → build KB → copy snippet → widget works → cross-tenant isolation
- [ ] Password reset implementation (`/auth/forgot`, `/auth/reset`)
- [ ] Rate limiting on auth endpoints
- [ ] Widget installation detection (`Widget.installedAt` — on first /engage with matching siteId)
- [ ] `SESSION_SECRET` not actually used yet (sessions use DB-backed token hashing, not signed cookies)

---

## 13. Known Limitations

- **VectorStore in-memory only**: All chunks held in Node.js heap. Fine for <100 websites with <25 pages each. Will not scale to thousands of tenants without pgvector/external store.
- **LRU eviction is per-process**: Multiple backend instances don't share cache. Cold starts re-read from disk.
- **Tenant cache (5min TTL) not invalidated on instruction update**: Dashboard edits to instructions won't reflect in widget responses for up to 5 minutes. `invalidateTenantCache()` exists but is not wired to instruction update routes.
- **No rate limiting**: Auth endpoints and public widget endpoints have no rate limiting.
- **Single-org sessions**: Login returns first org membership. No org-switching UI/API.
- **SSE build has no concurrency guard**: Two simultaneous builds for the same website will race.
- **Snapshot JSON files grow unbounded**: No cleanup/retention policy for old per-website snapshots.
- **`/ingest` route (legacy) has no auth**: Public endpoint, dev use only.

---

## 14. Appendices

### A. Complete New Files (Sprint 3)

```
backend/prisma/schema.prisma
backend/src/db/prisma.ts
backend/src/auth/password.ts
backend/src/auth/auth.service.ts
backend/src/auth/auth.middleware.ts
backend/src/auth/auth.routes.ts
backend/src/audit/audit.service.ts
backend/src/tenant/tenant.resolver.ts
backend/src/websites/website.repository.ts
backend/src/websites/website.service.ts
backend/src/websites/website.routes.ts
backend/src/instructions/instruction.service.ts
backend/src/instructions/instruction.routes.ts
backend/src/widgets/widget.service.ts
backend/src/widgets/widget.routes.ts
backend/src/knowledge/knowledge.service.ts
backend/src/knowledge/knowledge.routes.ts
backend/src/vectorstore/registry.ts
backend/src/config/crawl.ts
```

**Total: 19 new files**

### B. Complete Modified Files (Sprint 3)

```
backend/src/server.ts                    — Added cookie-parser, all S3 routers, hasDatabase health
backend/src/config/index.ts              — Added databaseUrl, sessionSecret, dashboardOrigin, widgetBaseUrl, knowledgeDir, legacySnapshotPath, hasDatabase
backend/src/config/retrieval.ts          — Added maxContextChars
backend/src/middleware/cors.ts           — Dynamic origin, credentials, PUT/PATCH/DELETE methods
backend/src/validation/requestSchemas.ts — Added optional siteId to engage/chat schemas
backend/src/vectorstore/persistence.ts   — Added websiteSnapshotPath, loadSnapshotFile, saveSnapshotFile; fixed broken knowledgeSnapshotPath reference
backend/src/context/provider.ts          — Added tenant param, per-website store resolution
backend/src/context/retriever.ts         — Added websiteId param, maxContextChars enforcement, per-website store
backend/src/services/ingestService.ts    — Added IngestOptions (websiteId, onPhase, language), per-website store path
backend/src/services/engageService.ts    — Added EngageOptions.tenant, passed to getBusinessContext
backend/src/services/chatService.ts      — Added tenant in ChatStreamInput, passed to getBusinessContext
backend/src/routes/engage.ts             — Tenant resolution from siteId when hasDatabase
backend/src/routes/chat.ts               — Tenant resolution from siteId when hasDatabase
backend/src/crawler/links.ts             — URL canonicalization (tracking-param strip, param sort, path exclusions)
```

**Total: 14 modified files**

### C. Complete API List

```
PUBLIC
  GET    /health
  POST   /engage
  POST   /chat
  POST   /ingest
  GET    /debug/rag                              (dev only)

AUTH
  POST   /auth/signup
  POST   /auth/login
  POST   /auth/logout
  GET    /auth/me                                 (requireAuth)
  POST   /auth/forgot                             (501)
  POST   /auth/reset                              (501)

PRIVATE (all requireAuth + ownership)
  GET    /api/websites
  POST   /api/websites
  GET    /api/websites/:id
  PATCH  /api/websites/:id
  DELETE /api/websites/:id
  GET    /api/websites/:id/instructions
  PUT    /api/websites/:id/instructions
  GET    /api/websites/:id/widget
  POST   /api/websites/:id/knowledge/build        (SSE response)
  GET    /api/websites/:id/knowledge/status
  GET    /api/websites/:id/knowledge/builds
```

**Total: 22 endpoints (17 functional, 2 stubbed, 1 dev-only, 2 health/static)**

### D. Complete Database Schema (SQL-equivalent)

```sql
-- Identity
User            (id UUID PK, email UNIQUE, passwordHash?, name, createdAt, updatedAt, deletedAt?)
Organization    (id UUID PK, name, slug UNIQUE, createdAt, updatedAt, deletedAt?)
OrganizationMember (id UUID PK, organizationId FK, userId FK, role ENUM, UNIQUE(orgId,userId))
Session         (id UUID PK, userId FK, organizationId FK, tokenHash UNIQUE, expiresAt, revokedAt?)
PasswordResetToken (id UUID PK, userId, tokenHash UNIQUE, expiresAt, usedAt?)

-- Resources
Website         (id UUID PK, organizationId FK, name, url, industry?, primaryLanguage, description?, deletedAt?, IDX(orgId))
BusinessInstruction (id UUID PK, websiteId UNIQUE FK, businessName, companyDescription?, tone, language, alwaysBookDemo, avoidDiscounts, allowedLinks JSON, preferredCta?, supportEmail?, supportPhone?, websiteUrl?)
Widget          (id UUID PK, websiteId UNIQUE FK, siteId UNIQUE, widgetPublicKey UNIQUE, status ENUM, installedAt?, lastRequestAt?, requestCount, IDX(siteId))

-- Knowledge
KnowledgeSnapshot (id UUID PK, websiteId FK, organizationId FK, version, embeddingModel, dimensions, pagesCrawled, chunkCount, sourceUrl, status ENUM, storageKey, error?, IDX(websiteId,version))
KnowledgeBuild  (id UUID PK, websiteId FK, organizationId FK, snapshotId? FK, status ENUM, currentPhase?, pages?, chunks?, error?, startedAt, finishedAt?, IDX(websiteId,startedAt))

-- Audit
AuditLog        (id UUID PK, organizationId? FK, userId? FK, action, targetType?, targetId?, metadata JSON, ip?, IDX(orgId,createdAt))
```

### E. Package Dependencies (Sprint 3 Additions)

```json
{
  "dependencies": {
    "@prisma/client": "^6.x",
    "bcryptjs": "^2.4.3",
    "cookie-parser": "^1.4.7"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.x",
    "@types/cookie-parser": "^1.4.8",
    "prisma": "^6.x"
  }
}
```

### F. NPM Scripts (Sprint 3 Additions)

```
prisma:generate  → prisma generate
prisma:migrate   → prisma migrate dev
prisma:studio    → prisma studio
```
