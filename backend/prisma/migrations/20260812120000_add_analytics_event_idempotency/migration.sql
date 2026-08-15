-- Existing events predate client event IDs and remain untouched. PostgreSQL
-- permits multiple NULLs in a unique index, so only newly identified events
-- participate in idempotency.
ALTER TABLE "AnalyticsEvent" ADD COLUMN "eventId" TEXT;

CREATE UNIQUE INDEX "AnalyticsEvent_websiteId_eventId_key"
  ON "AnalyticsEvent"("websiteId", "eventId");
