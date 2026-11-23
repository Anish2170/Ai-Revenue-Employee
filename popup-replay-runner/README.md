# Popup Test Lab

The dashboard controls a local Playwright runner. It browses your connected website using the existing widget, perception rules, knowledge retrieval and popup generation. A scenario describes browsing actions; it never assigns a popup type or confidence.

## Run a batch

After the backend migration and dashboard are deployed:

1. Open **Advanced → Popup Test Lab** as an owner or administrator. Create a pairing code.
2. In this directory run:

   ```powershell
   npm ci
   npx playwright install chromium
   npm start -- --backend https://ai-revenue-employee.onrender.com --headed
   ```

3. Paste the code into the hidden terminal prompt. Codes work once for ten minutes; runner authorization expires after 24 hours. Credentials stay in memory.
4. Choose a website, connected runner, desktop or mobile emulation, journeys and allowance. Begin with five journeys.
5. Review actual screenshots, copy, type, CTA destination, confidence, accepted signals, suppression reasons and reserved API usage. Rate displayed popups **Helpful**, **Generic**, or **Wrong context**; export the JSON report.
6. Stop from the dashboard or press Ctrl+C. Disconnect/revoke the runner when finished.

## Isolation and limits

- Each journey creates a fresh Chromium context, local storage, visitor and session. Identity is retained during navigation within that journey. Owner cookies never enter the visitor context.
- The runner uses real navigation, mouse movement, scrolling, typing and elapsed time. It does not fake events, confidence, clocks or `navigator.webdriver`.
- Only an owner-issued, run-scoped lease authorizes known QA automation. Ordinary traffic keeps its normal automation checks. Rate and burst checks remain active for QA. QA decisions and analytics are stored separately from customer analytics.
- Website pages may still record their own page views or third-party analytics; AI Employee's QA isolation does not control those systems.
- Browser writes are restricted to widget session, events, lifecycle and replay analytics. The runner never submits booking/contact forms, starts paid chat, or clicks a popup CTA. It records the configured destination; it does not claim the destination page or conversion was verified.
- A batch supports 1–50 journeys, up to $1 reserved allowance, 4 external attempts per journey and 200 per batch. Generation and query embeddings both count, including fallback attempts and timeouts. A conservative reservation occurs before each provider attempt. Only the reviewed model families are accepted; unsupported models fail closed. Reserved amounts are ceilings under the configured model pricing assumptions, not provider invoices.
- The first five journeys form a pilot. Errors, unexpected popups, or no positive-scenario displays pause the batch. Continue explicitly to run remaining journeys after review. Fifty journeys do **not** guarantee fifty popups. Stop revokes further work; a provider call already sent may finish and consume its existing reservation.
- Each journey has a two-minute deadline and a short renewable lease. Lost runners pause queued work; abandoned paid journeys are not silently retried. Screenshots/results expire after seven days. Test runs do not rebuild knowledge.

## Journey coverage

| Journey | Actual actions | Expected observation |
| --- | --- | --- |
| Fees/pricing | Find fees/plans links, read and revisit | Popup or an explained suppression |
| Research | Explore service/practice/program pages | Popup or an explained suppression |
| Comparison | Visit available program/service pages and revisit | Popup or an explained suppression |
| Trust | Prefer team, reviews, about or FAQs | Popup or an explained suppression |
| Form pause | Type synthetic text, pause without submitting | Assistance or an explained suppression |
| Chat open | Open the widget and keep it open | Silence with a chat-open safety trace |
| Typing | Continue typing in an available form | Silence with a typing safety trace |
| Hidden | Bring a second tab to the front | Silence with a hidden-tab trace |

Navigation is limited to same-origin links. Sites without a suitable form produce a failed journey rather than invented form activity. Prefer `--headed` for hidden-tab verification; unsupported browser visibility behavior produces a failure. Mobile is Chromium device emulation, not a physical iPhone or Safari. These are controlled scenarios, not a representative conversion-rate study or a replay of a recorded human session.

## Development checks

`npm test` runs runner planning checks. Backend `src/popup-replay/*.test.ts` covers lease authentication, result evidence, budget/stop boundaries and async scope. PostgreSQL/browser tests are opt-in through `REPLAY_TEST_DATABASE_URL` and guard the dedicated localhost test database and replay schema. The browser fixture runs the actual widget/backend with local provider stubs; it makes zero external AI calls. No live paid 50-journey batch is part of these checks.
