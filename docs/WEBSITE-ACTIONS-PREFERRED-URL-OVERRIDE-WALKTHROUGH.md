# Website Actions Preferred URL Override Walkthrough

This walkthrough summarizes the Preferred URL Override feature added for Website Actions. The goal is to keep Website Action Discovery automatic while giving business owners a safe way to correct the selected destination when the automatic preferred URL is not the best choice.

## 1. Product Scope

This is not Manual Business Actions.

The system still discovers business actions automatically during the Knowledge Build. The AI still returns only action intents such as:

```json
{
  "primaryAction": "book_demo"
}
```

The override only changes which already-discovered URL is used for that intent.

Example:

```text
book_demo -> /book
```

No custom URLs can be typed or saved.

## 2. Data Model

Added a database-backed override table:

- `ActionUrlOverride`

It stores:

- `organizationId`
- `websiteId`
- `intent`
- `url`
- timestamps

The table has a unique constraint on:

```text
websiteId + intent
```

That means each discovered intent can have at most one preferred URL override per website.

Changed files:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260712120000_add_action_url_overrides/migration.sql`

## 3. Backend Save and Clear APIs

Added two authenticated endpoints for discovered Website Actions:

```text
PUT /api/websites/:id/actions/discovered/:intent/override
DELETE /api/websites/:id/actions/discovered/:intent/override
```

The save endpoint accepts only:

```json
{
  "url": "https://example.com/book"
}
```

Before saving, the backend verifies:

- The website belongs to the organization.
- The intent is a known discovered action intent.
- The intent exists in the latest Action Graph.
- The selected URL exists in that intent's latest discovered candidates.

If the URL is not from the latest Knowledge Build candidates, the backend rejects it.

Changed files:

- `backend/src/business-actions/action.routes.ts`
- `backend/src/business-actions/action.service.ts`

## 4. Runtime CTA Resolution Priority

Discovered action resolution now follows this priority:

1. User override
2. Automatically selected preferred URL
3. Semantic fallback
4. Hide CTA

For a direct intent match, the backend checks for a saved override first. If that override still points to a currently discovered candidate, it is used.

If no valid override exists, the backend uses the automatically ranked preferred URL.

Semantic fallback still works for aliases such as:

- `contact_sales` -> `book_demo`
- `schedule_call` -> `book_demo`
- `request_consultation` -> `book_demo`
- `docs` -> `documentation`
- `help` -> `support`

Fallbacks intentionally use automatic preferred URLs, not arbitrary destinations.

## 5. Knowledge Build Reconciliation

After a successful Knowledge Build, Action Discovery runs again and produces a fresh Action Graph.

The override reconciliation step then checks all saved overrides for the website:

- If the overridden URL still exists in the latest candidates, the override is kept.
- If the overridden URL no longer exists, the override is deleted automatically.

When an override is removed because its URL disappeared, an audit log entry is written. The Website Actions dashboard uses that audit signal to show this notice:

```text
The previously selected URL no longer exists. The system has reverted to the automatically detected destination.
```

Changed file:

- `backend/src/knowledge/knowledge.service.ts`

## 6. Dashboard UI

Each Website Actions row now shows the Preferred URL with an Edit control.

When a manual override exists, the row displays:

```text
Manual Override
```

The badge tooltip says:

```text
This destination was manually selected by your team.
```

Clicking Edit opens a small modal showing:

- Intent
- Detected Business Action
- Current Preferred URL
- Alternative Discovered URLs

The modal uses radio buttons. There is no text input, so the user can only choose from URLs discovered during the latest Knowledge Build.

Changed files:

- `dashboard/src/app/(dashboard)/website-actions/page.tsx`
- `dashboard/src/lib/api.ts`

## 7. Safety Guarantees

The safety boundary is enforced on the backend, not just in the UI.

The UI does not expose custom URL input, but even a direct API request cannot save an arbitrary URL because the service checks the selected URL against the latest Action Graph candidates.

This preserves the zero-configuration model:

- The crawler remains the only source of destinations.
- The AI never invents or returns URLs.
- Business owners can correct selection only within known safe discovered destinations.

## 8. Verification Completed

Verified during implementation:

- Backend typecheck passes.
- Dashboard TypeScript check passes.
- Targeted Website Actions lint passes.
- Action discovery tests pass.
- Response validation tests pass.
- Popup generation tests pass.

Notes:

- The normal backend test command hit sandbox process-spawn restrictions on Windows. The relevant tests were rerun directly; tests needing `tsx` process spawn were run with approved elevation.
- Full dashboard lint still reports unrelated pre-existing issues outside Website Actions.

## 9. Expected Behaviour

When a business owner selects `/book` for `book_demo`, future popup CTA resolution uses `/book` for that intent.

If a later Knowledge Build still discovers `/book`, the override remains active.

If a later Knowledge Build no longer discovers `/book`, the override is removed and CTA resolution returns to the automatically selected preferred URL.