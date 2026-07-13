ALTER TABLE "AnalyticsEvent" ADD COLUMN "visitorRecordId" UUID;

UPDATE "AnalyticsEvent" e
SET "visitorRecordId" = v."id"
FROM "Visitor" v
WHERE e."websiteId" = v."websiteId"
  AND e."visitorId" = v."visitorId"
  AND e."visitorId" IS NOT NULL;

CREATE INDEX "AnalyticsEvent_visitorRecordId_idx" ON "AnalyticsEvent"("visitorRecordId");

ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_visitorRecordId_fkey" FOREIGN KEY ("visitorRecordId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;