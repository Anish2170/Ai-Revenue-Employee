# Website Actions Production Correctness Walkthrough

This walkthrough summarizes the production-readiness fixes made to Website Action Discovery. The scope was correctness only: no new product features, no architecture rewrite, and no UI redesign.

## 1. Problem Summary

Three P0 issues were addressed:

- UI-only controls were being treated as business actions.
- Preferred URL selection could choose a generic contact page over stronger demo destinations.
- Website Actions could show a failed last build even when Action Discovery data existed and was valid.

The fixes make the discovery pipeline stricter, make conversion URL ranking more intentional, and expose stage-level Knowledge Build status.

## 2. False Business Action Filtering

Action extraction now rejects UI-only controls earlier and more broadly.

The filter covers labels, attributes, roles, placeholders, test IDs, data-action values, surrounding DOM context, and social URLs. This prevents controls such as these from becoming business actions:

- Search
- Search input
- Search trigger
- Theme toggle
- Dark mode
- Light mode
- Cookie controls
- Pagination
- Previous / Next
- Sort
- Filter
- Breadcrumbs
- Share buttons
- Social links
- Language switchers

Important correction: search and theme controls stay ignored even when they appear on documentation pages. For example, `Search documentation` is still UI chrome, not a documentation business action.

Changed file:

- `backend/src/business-actions/actionDiscovery.ts`

## 3. Preferred URL Ranking

Preferred URL ranking now better represents the strongest business conversion destination.

The ranking considers:

- Hero CTA
- Homepage CTA
- Primary navigation
- URL semantics
- Button prominence
- Internal frequency
- Confidence

The most important production correction is that explicit demo destinations are ranked above generic contact destinations for demo/sales intent.

For example, when these URLs are discovered:

- `/book-demo`
- `/request-demo`
- `/schedule-demo`
- `/contact`

The preferred `book_demo` URL should be one of the explicit demo destinations, not `/contact`, unless no demo destination exists.

`Contact Sales` is also treated as part of the demo/sales conversion family, so it does not push the system toward a generic contact intent when stronger demo routes are available.

Changed file:

- `backend/src/business-actions/actionDiscovery.ts`

## 4. Knowledge Build Stage Status

The Knowledge Build pipeline now emits an explicit `action_discovery` phase.

Previously, the Website Actions page only received a collapsed last-build status. That made this case misleading:

- Crawl succeeded
- Chunking succeeded
- Embeddings succeeded
- Action Discovery succeeded
- Snapshot save failed

The page could show `Last Build (FAILED)` even though valid Action Discovery data existed.

The backend now derives stage-level status for the Website Actions payload, including:

- Crawler
- Chunking
- Embeddings
- Action Discovery
- Snapshot Save

If a failed build still has successful stages and valid discovery data, the top-level Website Actions build status is shown as `PARTIAL_SUCCESS` rather than plain `FAILED`.

Changed files:

- `backend/src/services/ingestService.ts`
- `backend/src/knowledge/knowledge.service.ts`
- `backend/src/business-actions/action.service.ts`
- `dashboard/src/app/(dashboard)/website-actions/page.tsx`

## 5. Dashboard Display

The Website Actions page now shows compact stage-level build status in the existing build status card.

The UI remains intentionally small and operational. It uses the existing card and page structure, adding only the status detail required to avoid a misleading failed build message.

No dashboard redesign was performed.

Changed file:

- `dashboard/src/app/(dashboard)/website-actions/page.tsx`

## 6. Regression Tests

Focused regressions were added for the two action-discovery correctness cases.

### Demo Preferred URL

Fixture includes:

- `Book Demo`
- `Request Demo`
- `Schedule Demo`
- `Contact Sales`
- `/contact`

Expected result:

- The `book_demo` preferred URL resolves to the explicit demo destination.
- `/contact` is not selected when a demo route exists.

### Documentation UI Controls

Fixture includes:

- Search documentation
- Toggle theme
- Dark mode
- Filter
- Pagination next / previous
- Share button
- Social link
- Language switcher
- API Docs

Expected result:

- UI controls do not appear as business actions.
- The actual documentation action still survives.

Changed file:

- `backend/src/business-actions/actionDiscovery.test.ts`

## 7. Verification Results

Backend verification:

```bash
npm test
```

Result:

- Passed: 76 / 76 tests

Backend typecheck:

```bash
npm run typecheck
```

Result:

- Passed

Dashboard production build:

```bash
npm run build
```

Result:

- Passed

Dashboard lint:

```bash
npm run lint
```

Result:

- Failed on pre-existing lint issues in dashboard files, including existing `setState`-in-effect and `any` patterns. These were not expanded into this fix because the requested scope was production correctness for Website Action Discovery only.

## 8. Files Changed

- `backend/src/business-actions/actionDiscovery.ts`
- `backend/src/business-actions/actionDiscovery.test.ts`
- `backend/src/business-actions/action.service.ts`
- `backend/src/services/ingestService.ts`
- `backend/src/knowledge/knowledge.service.ts`
- `dashboard/src/app/(dashboard)/website-actions/page.tsx`

## 9. Production Behavior After Fix

The system now behaves as follows:

- UI chrome does not become a business action.
- Demo and sales CTAs prefer explicit conversion destinations over generic contact pages.
- Valid Action Discovery data is not hidden behind an inaccurate failed build label.
- Build failures are shown at the stage where they occurred.
- The Website Actions page remains focused on existing functionality and does not introduce new product behavior.
