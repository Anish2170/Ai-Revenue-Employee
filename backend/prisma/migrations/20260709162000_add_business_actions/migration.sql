CREATE TYPE "BusinessActionDestinationType" AS ENUM ('URL', 'CHAT', 'WHATSAPP', 'PHONE', 'EMAIL');

CREATE TABLE "BusinessAction" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "websiteId" UUID NOT NULL,
  "actionId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "destinationType" "BusinessActionDestinationType" NOT NULL,
  "destination" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "isStarter" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BusinessAction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessAction_websiteId_actionId_key" ON "BusinessAction"("websiteId", "actionId");
CREATE INDEX "BusinessAction_organizationId_enabled_idx" ON "BusinessAction"("organizationId", "enabled");
CREATE INDEX "BusinessAction_websiteId_enabled_idx" ON "BusinessAction"("websiteId", "enabled");

ALTER TABLE "BusinessAction" ADD CONSTRAINT "BusinessAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessAction" ADD CONSTRAINT "BusinessAction_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AnalyticsEvent" ADD COLUMN "actionId" TEXT;
CREATE INDEX "AnalyticsEvent_websiteId_actionId_occurredAt_idx" ON "AnalyticsEvent"("websiteId", "actionId", "occurredAt");

ALTER TABLE "AiDecisionLog" ADD COLUMN "ctaActionId" TEXT;