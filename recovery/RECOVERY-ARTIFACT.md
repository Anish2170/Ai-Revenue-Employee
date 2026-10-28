# Frozen rollback-compatible recovery application

Local compatibility verified; not published to GitHub or deployed to Render/Vercel.

This is a distinct recovery variant of the locally verified release source, based on repository HEAD 81debbd plus the preserved uncommitted fixes. It is not the old 81debbd application and does not claim a new Git commit.

- Backend retains the same snapshot reader, source/tenant/scope validation, grounded chat, auth/session/CSRF rules and previous-good recovery.
- Knowledge worker startup is removed. Legacy ingestion and private dashboard mutations are refused. Private mutations still require authentication/CSRF before refusal. Existing public chat/visitor routes retain their normal behavior, including ordinary persistence when actually activated.
- Recovery dashboard displays original approved exclusions/limitations, pauses knowledge controls, shows persisted job status as historical, and refreshes status only on explicit request. It does not fake cancellation or strip scope metadata.
- Backend/widget/frontend builds, 89 unique focused checks (overlapping runs counted once), compiled-server startup, real downloaded strict-snapshot acceptance, synthetic approved-scope/corruption recovery and browser omission warnings passed locally. Previous 885 tests were not rerun.

Prerequisites for activation:

1. The nullable configuration migration must already be applied and verified. This recovery artifact must NOT be deployed for the credential rotation while the hosted schema has only 17 migrations.
2. Preserve the exact existing R2 reference in protected-snapshot-reference.json. Do not run retention, overwrite or restore it automatically.
3. Render currently deploys Git source, not this local ZIP directly. After separate authorization, place this frozen variant at an immutable commit in the SAME repository with a skip-render commit message. Record that commit/provider activation reference before marking hosted rollback ready. No push/branch/provider-source change was made here.
4. Use the same existing Render service, database/env and private R2 bucket. Do not run migrations as recovery; the existing build's migration step must find zero pending SQL.
5. Keep a healthy limited-scope-compatible frontend if available. If frontend recovery is needed, deploy the paired dashboard from this artifact to the SAME Vercel project/API URL. Never restore the old warning-blind dashboard after limited publication.

Source package layout follows the existing build layout. Run pinned `npm ci --include=dev` in widget/backend/dashboard when reproducing; backend postinstall generates Prisma Client from the included schema. Build widget, then backend, then dashboard. Dashboard uses `next build --webpack`, with the existing public Render API URL. Current installed dependency junctions used for local verification are EXCLUDED from the ZIP, as are secrets, customer bytes, local databases, screenshots, caches and logs. Compiled backend/widget and frontend build outputs are included alongside source/locks; the existing providers can rebuild from source.

The bundle is hash-manifested, not cryptographically signed or provider-hosted. Local Node 22.19.0 was used; provider activation/runtime/RTO remains to be verified. Recovery preserves committed database data (no DB restore). A database PITR restore is a different destructive recovery operation requiring separate point-in-time/data-loss approval. Do not restore the exposed old DB password during failure recovery.

Final artifact version: v2. The auth-failure forwarding guard is verified by six final guard checks; use the v2 ZIP and final hash, not the preserved draft v1.
