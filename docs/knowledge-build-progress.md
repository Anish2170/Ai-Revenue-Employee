# Knowledge build speed and progress

Action discovery reuses successful AI classifications within a build when the full destination URL and classification prompt match. Different contexts and query destinations remain separate. Every original occurrence remains available for ranking and diagnostics. At most two candidates are processed concurrently; appointment booking labels have an explicit rule. There is no AI-call cutoff, and failed requests are not cached. Crawled content, chunking, and embedding inputs/models are unchanged.

The worker reports crawl counts after each crawl wave and action counts at most once per second (plus the first and final updates). The dashboard polls every 1.5 seconds and now delivers counter updates even within the same phase. Reopening the knowledge tab restores persisted progress. The bar uses estimated stage weights and measured counters, stays below 100% until SUCCESS, and shows queued, retry, failure, cancellation, and connection-loss states. It is not an estimate of time remaining. Embedding counts are reported when the existing embedding operation finishes; this change does not split or alter embedding batches.

## Deployment

Apply the additive migration before starting the updated backend:

```sh
cd backend
npm run prisma:migrate:deploy
npm run prisma:generate
npm run build
```

Deploy the backend and dashboard together to enable the new counters. No production migration or deployment was performed as part of local implementation. Measure a real rebuild after deployment to establish the speed improvement; savings depend on repeated action contexts and API availability.

## Validation

- Backend type-check and 150 backend tests passed.
- Dashboard type-check, targeted ESLint, five frontend tests, and Next.js production build passed.
- New tests cover identical-input reuse, separate contexts/query destinations, retained raw occurrences, bounded concurrency, recovery after failed classification, same-phase polling updates, unknown totals, and terminal progress behavior.
