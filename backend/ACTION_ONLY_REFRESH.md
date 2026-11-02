# Action-only refresh and rollback

This operator CLI works for any existing website. It uses its currently published
page inventory and the existing action extractor/classifier in **rules-only**
mode. It never calls knowledge ingestion, browser rendering, embedding generation
or paid model generation. No database migration or new environment variable is
needed. Run from the existing backend environment after building/deploying it.

Use the intended **organization, website and active owner user IDs** explicitly.
The CLI verifies all three against current database state; historical IDs from a
release report are not an authorization shortcut.

```powershell
npm run actions:refresh -- --mode dry-run --organization-id <ORG_UUID> --website-id <WEBSITE_UUID> --user-id <OWNER_UUID> --plan action-review.json
```

Dry-run is also the default mode. It performs no database/R2 writes. The local
plan file must be new. It reports old/new groups, labels and destinations,
differences, every existing preferred-URL override's impact, source outcomes,
budgets and blockers. Exit 0 means reviewable, 2 means blocked, 1 means an error.
The report includes a SHA-256 `reviewDigest`, pinned snapshot/build/website/
override state, and an expiry of one hour. Review the destinations before apply.

Fetch scope is the saved published inventory only, capped at 50 pages by default
(hard maximum 100). No links or sitemaps are followed. robots.txt is the one
additional policy request. Current robots rules, original approved exclusions,
path exclusions, query-secret checks, DNS pinning, public IP checks and same-origin
redirect checks all apply. Redirect targets must also be in the permitted saved
inventory. Responses, total bytes, request count and elapsed time are bounded.
Failed, restricted, dynamic/unreadable or over-budget pages block apply; the tool
does not publish a partial replacement. Dry-run budget flags are documented by
`npm run actions:refresh -- --help`.

```powershell
npm run actions:refresh -- --mode apply --organization-id <ORG_UUID> --website-id <WEBSITE_UUID> --user-id <OWNER_UUID> --plan action-review.json --review-sha256 <REVIEW_DIGEST> --allow-production-apply
```

The final flag is required only when `NODE_ENV=production`; it is a deliberate
operator write gate, not permission to run this during a read-only review.
Apply re-fetches and recomputes the report. Changed page bytes, policies, groups,
destinations, owner/website state, overrides, build history or snapshot require a
fresh dry-run. Active builds are rejected. A valid report digest alone cannot
supply arbitrary actions: apply uses the freshly extracted/classified graph.

Apply clones the verified snapshot and changes only `actionGraph`, publication
identity and additive action-refresh provenance. Published knowledge timestamps,
documents, vectors, hashes, pages, links, coverage and scope approval are retained.
Business settings, manual actions and URL override rows are never written.
An override absent from the proposed graph **blocks apply** instead of being
deleted or silently reset; the owner must resolve it through normal settings and
then create a new dry-run.

A fresh per-version object is written, checksum/read-back validated, and activated
by inserting a newer READY metadata row plus its audit/rollback pins in one
database transaction. The current object's bytes and metadata are not overwritten.
Publication uses the same website row lock as build enqueue/publication, rechecks
ownership and all fences after upload, and briefly SHARE-locks the override table
to include concurrent inserts in the final check. No network request runs inside
the activation transaction. A failed upload/publication leaves previous READY
state intact; an uploaded but unactivated artifact may remain. No cleanup/delete
operation is performed by this tool.

Audit pins protect both old and new versions from later automatic snapshot
retention, including the full action-refresh rollback chain. They are intentionally
not expired automatically. This increases retained storage with each refresh.
Relevant process caches are invalidated; other readers observe the new READY
identity. If `cachesRefreshed` is false, the publication **has committed**: inspect
the receipt/audit and restart the affected backend process rather than rerunning
the old plan.

Rollback uses the immediate protected parent graph and creates another immutable
version; it does not remove versions or restore old knowledge/settings. It uses no
page requests and has the same fresh-state, override and digest checks:

```powershell
npm run actions:refresh -- --mode rollback-dry-run --organization-id <ORG_UUID> --website-id <WEBSITE_UUID> --user-id <OWNER_UUID> --plan rollback-review.json
npm run actions:refresh -- --mode rollback-apply --organization-id <ORG_UUID> --website-id <WEBSITE_UUID> --user-id <OWNER_UUID> --plan rollback-review.json --review-sha256 <ROLLBACK_REVIEW_DIGEST> --allow-production-apply
```

Keep receipts and both reviewed plans. If a plan is stale, blocked or expired,
create a fresh plan; do not edit its fields or override its digest. A normal full
knowledge build is neither a prerequisite nor a fallback triggered by this tool.
