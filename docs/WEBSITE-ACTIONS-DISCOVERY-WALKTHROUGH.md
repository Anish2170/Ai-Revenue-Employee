# Website Actions Discovery Walkthrough

This walkthrough summarizes the work completed in this chat to replace manual CTA setup with an automatic, crawl-driven Website Actions system.

## 1. Intelligent Action Discovery

Added a crawl-time action discovery system that inspects the full page DOM before knowledge text cleanup. It scans navigation, headers, footers, hero CTAs, buttons, links, forms, cards, pricing areas, and contact sections.

For every meaningful action, the system captures:

- Label
- Destination URL
- Source page
- DOM location
- Anchor text
- Surrounding heading
- Page title
- Page description
- Ranking signals such as hero CTA, navigation, button prominence, homepage priority, and internal link frequency

The crawler now returns discovered raw actions alongside crawled pages, and ingestion builds an Action Graph after every Knowledge Build.

## 2. Intent Classification

Added business-intent classification for discovered actions.

The rule classifier maps different business labels into stable intents, including:

- `book_demo`
- `pricing`
- `contact`
- `support`
- `free_trial`
- `login`
- `signup`
- `documentation`
- `learn_more`

Labels such as “Book Demo,” “Schedule Call,” “Talk to Sales,” “Meet an Expert,” and “Request Consultation” all resolve to `book_demo`.

Rule classification runs first. If confidence is low and Gemini is available, Gemini is used only to classify the intent and confidence. It never invents or changes URLs.

## 3. Action Graph Persistence

Added a persisted `actionGraph` to knowledge snapshots.

Each graph groups candidates by intent, ranks them, and stores the preferred URL plus alternatives. Ranking uses:

- Hero CTA signal
- Navigation signal
- Button prominence
- Homepage priority
- Internal link frequency
- Classification confidence

The crawled website remains the only source of URLs.

## 4. Backend Action Resolution

Changed enabled business actions so the runtime can resolve from the discovered Action Graph.

The AI now chooses only an intent such as:

```json
{
  "primaryAction": "book_demo"
}
```

The backend resolves that intent to the preferred crawled URL, such as `/book-demo` or `/schedule-call`.

Semantic fallback aliases were added, for example:

- `talk_with_specialist` -> `book_demo`
- `schedule_call` -> `book_demo`
- `request_consultation` -> `book_demo`
- `docs` -> `documentation`
- `help` -> `support`

If no matching or fallback intent exists, no CTA URL is invented.

## 5. Knowledge Debug Additions

Added a developer-facing “Discovered Website Actions” section to Knowledge Debug.

It shows:

- Intent
- Detected label
- Resolved URL
- Confidence
- Detection method
- Rule
- Source page
- Why selected
- Alternative candidates

This is useful for inspecting the exact decisions made by the discovery pipeline.

## 6. Website Actions Dashboard

Added a new business-facing dashboard page at:

```text
/website-actions
```

This page is designed for business owners, not developers. It is read-only and does not require manual setup.

The page includes:

- Summary cards
- Last crawl/build/discovery timestamps
- Visual website action map
- Intent grouping
- Search by intent, label, URL, or page
- Filters for high confidence, needs review, unknown, rule, LLM, and hybrid
- Action table
- Expandable row details
- Action analytics
- Empty state when no actions are discovered

The dashboard sidebar now links to “Website Actions.”

## 7. Website Actions API

Added a read-only endpoint:

```text
GET /api/websites/:id/actions/discovered
```

It returns:

- Summary metrics
- Timestamps
- Intent groups
- All discovered action rows
- Visual website map data
- Per-intent analytics

Analytics includes:

- Popup uses
- Clicks
- CTR
- Conversions

The old manual Business Actions routes were left in place for compatibility, but the new page does not expose manual URL configuration.

## 8. Verification

Added focused backend tests for the new discovery behavior.

Verified that:

- Varied labels resolve to the same intent
- `Book Demo`, `Schedule Call`, `Talk to Sales`, `Meet an Expert`, and `Request Consultation` resolve to `book_demo`
- URLs are only taken from crawled website links
- Pricing, support, trial, auth, and documentation intents classify correctly

Builds and tests passed:

- Backend build passed
- Backend tests passed: 72/72
- Dashboard build passed

Some commands needed sandbox approval because Windows blocked Node/Next worker spawning with `spawn EPERM`; rerunning outside the sandbox passed.

