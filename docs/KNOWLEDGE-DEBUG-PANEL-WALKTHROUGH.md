# Knowledge Debug Panel Walkthrough

## Goal

The Knowledge Debug panel was added so developers and admins can inspect the full RAG pipeline when the AI gives an unexpected answer. The page is read-only and works per website.

It is intended to answer questions like:

- Did the crawler capture the right text?
- Was useful content removed during cleaning?
- Were chunks created correctly?
- Were embeddings present?
- Did retrieval find the right chunks?
- What exact prompt/context was sent to Gemini?
- What raw response came back from Gemini?
- Where did time go in the pipeline?
- Are there obvious knowledge quality issues?

## New Dashboard Page

Added a new dashboard route:

```text
/knowledge-debug
```

The page is linked from the dashboard sidebar as:

```text
Knowledge Debug
```

The page starts with a website selector and loads debug data for the selected website.

## Files Added

### Backend

```text
backend/src/knowledge/knowledge-debug.service.ts
backend/src/knowledge/knowledge-debug.routes.ts
```

### Dashboard

```text
dashboard/src/app/(dashboard)/knowledge-debug/page.tsx
```

### Documentation

```text
docs/KNOWLEDGE-DEBUG-PANEL-WALKTHROUGH.md
```

## Files Updated

### Backend

```text
backend/src/context/types.ts
backend/src/services/ingestService.ts
backend/src/vectorstore/index.ts
backend/src/vectorstore/registry.ts
backend/src/server.ts
```

### Dashboard

```text
dashboard/src/app/(dashboard)/layout.tsx
dashboard/src/lib/api.ts
```

## Backend Implementation

### 1. Snapshot Debug Metadata

The existing knowledge system stores the live knowledge artifact as a snapshot file. Before this work, snapshots contained:

- Snapshot metadata
- Site links
- Page metadata
- Embedded chunks

They did not persist complete per-page crawler debug output.

I extended `KnowledgeSnapshot` in `backend/src/context/types.ts` with an optional `debugPages` field. It is optional so older snapshots remain compatible.

Each debug page stores:

- URL
- Path
- Title
- Crawl status
- HTTP status
- Raw extracted text
- Cleaned text
- Extracted text length
- Cleaned text length
- Word count
- Chunk count
- Last crawled time
- Renderer classification
- Cleaning flags and notes

### 2. Ingestion Now Captures Debug Pages

Updated `backend/src/services/ingestService.ts` so future knowledge builds create a `debugPages` array after crawling, chunking, and embedding.

For each crawled page it records:

- The stored extracted text
- The stored cleaned text
- Word count
- Character lengths
- Number of chunks created for the page
- Cleaning category flags

Important limitation: the current crawler returns post-extraction readable text. It does not yet persist exact removed fragments from nav/footer/scripts/cookie banners. Because of that, the debug metadata includes cleaning notes explaining that the category flags represent configured removal selectors, not full removed-fragment diffs.

### 3. Snapshot Persistence Updated

Updated both snapshot persistence paths:

```text
backend/src/vectorstore/index.ts
backend/src/vectorstore/registry.ts
```

This ensures `debugPages` is written into:

- Legacy/dev singleton snapshots
- Per-website production snapshots

### 4. Read-Only Debug Service

Added `backend/src/knowledge/knowledge-debug.service.ts`.

This service only reads snapshot data. It does not modify knowledge, rebuild indexes, delete records, or write to the database.

It provides:

- Overview data
- Paginated crawled page rows
- Lazy page detail loading
- Paginated chunk rows
- Lazy full chunk loading
- Real retrieval test
- Final prompt assembly
- Raw Gemini response capture
- Pipeline timing
- Quality checks
- Visual flow stage data
- Export payloads

### 5. Read-Only Debug Routes

Added `backend/src/knowledge/knowledge-debug.routes.ts`.

Routes added:

```text
GET  /api/websites/:id/knowledge/debug/overview
GET  /api/websites/:id/knowledge/debug/pages
GET  /api/websites/:id/knowledge/debug/pages/detail?url=...
GET  /api/websites/:id/knowledge/debug/chunks
GET  /api/websites/:id/knowledge/debug/chunks/:chunkId
POST /api/websites/:id/knowledge/debug/search-test
GET  /api/websites/:id/knowledge/debug/quality-checks
GET  /api/websites/:id/knowledge/debug/visual-flow
GET  /api/websites/:id/knowledge/debug/export?format=json|markdown|txt
```

All routes use dashboard authentication through `requireAuth` and website ownership checks through `assertWebsiteOwnership`.

This makes the panel admin/dashboard-only according to the current app auth model.

### 6. Server Registration

Registered the new router in `backend/src/server.ts`:

```ts
app.use(knowledgeDebugRouter);
```

## Dashboard Implementation

### 1. API Client Methods

Added debug API methods to `dashboard/src/lib/api.ts`:

- `getKnowledgeDebugOverview`
- `getKnowledgeDebugPages`
- `getKnowledgeDebugPageDetail`
- `getKnowledgeDebugChunks`
- `getKnowledgeDebugChunkDetail`
- `runKnowledgeDebugSearch`
- `getKnowledgeDebugQualityChecks`
- `getKnowledgeDebugVisualFlow`

### 2. Navigation Link

Updated `dashboard/src/app/(dashboard)/layout.tsx` to include:

```text
Knowledge Debug
```

### 3. Knowledge Debug UI

Added `dashboard/src/app/(dashboard)/knowledge-debug/page.tsx`.

The page includes the requested sections.

## Page Sections Implemented

### Section 1: Crawled Pages

Shows a paginated table with:

- URL
- Title
- Crawl Status
- HTTP Status
- Word Count
- Extracted Text Length
- Chunk Count
- Last Crawled
- Last Embedded

Clicking a URL expands the row and lazy-loads page detail.

Expanded detail shows raw extracted text exactly as stored when available. For older snapshots that do not contain `debugPages`, the UI clearly shows that raw crawler text was not captured in that snapshot.

### Section 2: Cleaned Text

The expanded page detail also shows cleaned text and cleaning diagnostics:

- Removed navigation
- Removed footer
- Removed scripts
- Removed cookie banners
- Removed duplicated content
- Before length
- After length
- Notes

For older snapshots, the panel falls back to reconstructed text from stored chunks and marks that full cleaning diagnostics were not captured.

### Section 3: Chunks

Shows a paginated chunk table with:

- Chunk number
- Chunk ID
- Token estimate
- Character count
- Embedding status
- Page URL
- Preview

Clicking a chunk ID lazy-loads the full stored chunk content exactly as stored in the snapshot.

### Section 4: Search Test

Includes a question input defaulted to:

```text
How do I install the widget?
```

Clicking `Test Retrieval` runs the real retrieval path using the stored snapshot and query embedding.

It returns the top 10 chunks sorted by similarity, including:

- Similarity score
- Chunk ID
- Page URL
- Chunk preview
- Full chunk in an expandable detail block
- Whether the chunk was kept for the final prompt

### Section 5: Final LLM Context

After retrieval, the panel shows the exact assembled context for Gemini:

- Business Instructions
- Conversation Summary
- Conversation Memory
- Retrieved Knowledge
- Recent Messages
- Prompt Instructions
- System Prompt
- Complete assembled provider payload

No truncation is applied in the debug payload.

### Section 6: LLM Response

The search test calls Gemini through the existing `streamChat` path and captures the raw text streamed back.

The panel shows:

- Raw Gemini response
- Any LLM error if the provider call fails

### Section 7: Pipeline Timing

The debug result includes timings for:

- Crawler
- Cleaning
- Chunking
- Embedding
- Retrieval
- Prompt Assembly
- LLM
- Validation
- Total

For a search test, historical build phases such as crawler/cleaning/chunking are shown as zero because the panel is inspecting the already-built snapshot, not rebuilding knowledge.

### Section 8: Quality Checks

The backend automatically detects and reports:

- Pages with zero content
- Pages under 100 words
- Duplicate chunks
- Chunks larger than configured size
- Chunks with no embedding
- Broken URLs when status data exists
- 404 pages when status data exists
- Static pages
- JS-rendered pages when renderer data exists

Some checks depend on fields that only future snapshots will persist fully.

### Section 9: Visual Flow

The panel displays the pipeline flow:

```text
Website
?
Crawler
?
Cleaned Text
?
Chunks
?
Embeddings
?
Retrieved Chunks
?
Prompt
?
Gemini
?
Answer
```

Each stage is rendered as a clickable button. Clicking scrolls to the related section when that section exists on the page.

### Section 10: Download

The panel supports exporting the debug session as:

- JSON
- Markdown
- TXT

Export route:

```text
GET /api/websites/:id/knowledge/debug/export?format=json|markdown|txt
```

## Security

The panel is protected by:

- `requireAuth`
- `assertWebsiteOwnership`

It is read-only. The debug service reads snapshot files and performs retrieval/prompt/LLM inspection only. It does not rebuild, update, delete, or mutate knowledge.

## Performance

The panel avoids loading everything at once:

- Pages are paginated
- Chunks are paginated
- Full raw page detail loads only when a page is expanded
- Full chunk content loads only when a chunk is expanded

## Compatibility With Existing Snapshots

Existing knowledge snapshots do not contain `debugPages`.

The panel still works with those snapshots, but some sections show fallback data:

- Raw crawler output may show `Not captured in this snapshot.`
- Cleaned text may be reconstructed from stored chunks
- Cleaning diagnostics may include a note that the snapshot predates persisted cleaning diagnostics

To get complete crawler and cleaning debug data, rebuild knowledge for the website after this implementation.

## Verification Performed

Backend verification:

```text
npm run typecheck
```

Result: passed.

Dashboard verification for the new page:

```text
npx eslint "src/app/(dashboard)/knowledge-debug/page.tsx"
```

Result: passed.

Full dashboard lint was also attempted:

```text
npm run lint
```

It failed because of pre-existing lint errors in unrelated files:

- `dashboard/src/app/(dashboard)/conversations/page.tsx`
- `dashboard/src/app/(dashboard)/websites/[id]/page.tsx`
- `dashboard/src/components/analytics-view.tsx`

The new Knowledge Debug page passed lint in isolation.

Dashboard typecheck was attempted, but the dashboard package does not currently define a `typecheck` script.

## SmartDesk AI Verification Status

The requested verification scenario was:

```text
Website: SmartDesk AI
Search: How do I install the widget?
```

The implementation is wired for that exact test through the Search Test section.

I did not complete a live authenticated SmartDesk AI browser verification during the implementation pass because the full app session was not started and authenticated in this environment.

Once the app is running and logged in, the verification steps are:

1. Open the dashboard.
2. Go to `Knowledge Debug`.
3. Select the SmartDesk AI website.
4. If the snapshot predates this work, rebuild knowledge once to capture full `debugPages` data.
5. Enter `How do I install the widget?`.
6. Click `Test Retrieval`.
7. Confirm the page exposes:
   - Raw crawler output
   - Cleaned text
   - Stored chunks
   - Retrieved chunks
   - Similarity scores
   - Final prompt sent to Gemini
   - Raw Gemini response

## Important Follow-Up

The current crawler should eventually be enhanced to persist richer cleaning diagnostics directly from the extraction stage, including exact before/after removal evidence for:

- Navigation
- Footer
- Scripts
- Cookie banners
- Duplicate content

The panel is ready to display that data, but the extraction pipeline currently only exposes the final readable text and configured removal categories.