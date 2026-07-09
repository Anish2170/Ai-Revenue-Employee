-- CreateEnum
CREATE TYPE "AnalyticsEventCategory" AS ENUM ('VISITOR', 'PAGE', 'POPUP', 'CHAT', 'KNOWLEDGE', 'WIDGET');

-- CreateTable
CREATE TABLE "AnalyticsVisitor" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "visitorId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returning" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AnalyticsVisitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsSession" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "analyticsVisitorId" UUID NOT NULL,
    "sessionId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "returning" BOOLEAN NOT NULL DEFAULT false,
    "device" TEXT,
    "browser" TEXT,
    "referrer" TEXT,
    "entryPagePath" TEXT,
    "engaged" BOOLEAN NOT NULL DEFAULT false,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "aiResponseCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "analyticsVisitorId" UUID,
    "analyticsSessionId" UUID,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "category" "AnalyticsEventCategory" NOT NULL,
    "eventName" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pageUrl" TEXT,
    "pagePath" TEXT,
    "pageTitle" TEXT,
    "referrer" TEXT,
    "device" TEXT,
    "browser" TEXT,
    "surface" TEXT,
    "popupType" TEXT,
    "sourceTitle" TEXT,
    "sourceUrl" TEXT,
    "knowledgeBuildId" UUID,
    "durationMs" INTEGER,
    "numericValue" DOUBLE PRECISION,
    "reason" TEXT,
    "label" TEXT,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsVisitor_websiteId_visitorId_key" ON "AnalyticsVisitor"("websiteId", "visitorId");
CREATE INDEX "AnalyticsVisitor_organizationId_lastSeenAt_idx" ON "AnalyticsVisitor"("organizationId", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsSession_websiteId_sessionId_key" ON "AnalyticsSession"("websiteId", "sessionId");
CREATE INDEX "AnalyticsSession_organizationId_startedAt_idx" ON "AnalyticsSession"("organizationId", "startedAt");
CREATE INDEX "AnalyticsSession_websiteId_startedAt_idx" ON "AnalyticsSession"("websiteId", "startedAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_organizationId_occurredAt_idx" ON "AnalyticsEvent"("organizationId", "occurredAt");
CREATE INDEX "AnalyticsEvent_websiteId_occurredAt_idx" ON "AnalyticsEvent"("websiteId", "occurredAt");
CREATE INDEX "AnalyticsEvent_organizationId_eventName_occurredAt_idx" ON "AnalyticsEvent"("organizationId", "eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_websiteId_eventName_occurredAt_idx" ON "AnalyticsEvent"("websiteId", "eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_websiteId_sessionId_occurredAt_idx" ON "AnalyticsEvent"("websiteId", "sessionId", "occurredAt");
CREATE INDEX "AnalyticsEvent_websiteId_popupType_occurredAt_idx" ON "AnalyticsEvent"("websiteId", "popupType", "occurredAt");
CREATE INDEX "AnalyticsEvent_websiteId_pagePath_occurredAt_idx" ON "AnalyticsEvent"("websiteId", "pagePath", "occurredAt");

-- AddForeignKey
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsVisitor" ADD CONSTRAINT "AnalyticsVisitor_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsSession" ADD CONSTRAINT "AnalyticsSession_analyticsVisitorId_fkey" FOREIGN KEY ("analyticsVisitorId") REFERENCES "AnalyticsVisitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_analyticsVisitorId_fkey" FOREIGN KEY ("analyticsVisitorId") REFERENCES "AnalyticsVisitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_analyticsSessionId_fkey" FOREIGN KEY ("analyticsSessionId") REFERENCES "AnalyticsSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;