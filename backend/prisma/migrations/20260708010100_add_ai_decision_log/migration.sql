CREATE TABLE "AiDecisionLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "websiteId" UUID NOT NULL,
  "sessionId" TEXT NOT NULL,
  "visitorId" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "pageUrl" TEXT,
  "pagePath" TEXT,
  "pageTitle" TEXT,
  "behaviorSummary" TEXT,
  "behaviorDominant" TEXT,
  "intentSummary" TEXT,
  "intentGoal" TEXT,
  "intentReadiness" TEXT,
  "salesStrategy" TEXT,
  "confidenceScore" DOUBLE PRECISION,
  "confidenceBand" TEXT,
  "speakScore" DOUBLE PRECISION,
  "decision" TEXT NOT NULL,
  "reason" TEXT,
  "popupGenerated" BOOLEAN NOT NULL DEFAULT false,
  "popupSuppressed" BOOLEAN NOT NULL DEFAULT false,
  "suppressionReason" TEXT,
  "generatedPopupType" TEXT,
  "generatedPopupTitle" TEXT,
  "ctaType" TEXT,
  "ctaText" TEXT,
  "llmUsed" BOOLEAN NOT NULL DEFAULT false,
  "validationPassed" BOOLEAN NOT NULL DEFAULT false,
  "finalOutcome" TEXT NOT NULL,
  "popupDisplayed" BOOLEAN NOT NULL DEFAULT false,
  "popupClicked" BOOLEAN NOT NULL DEFAULT false,
  "popupDismissed" BOOLEAN NOT NULL DEFAULT false,
  "chatOpened" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiDecisionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiDecisionLog_organizationId_occurredAt_idx" ON "AiDecisionLog"("organizationId", "occurredAt");
CREATE INDEX "AiDecisionLog_websiteId_occurredAt_idx" ON "AiDecisionLog"("websiteId", "occurredAt");
CREATE INDEX "AiDecisionLog_websiteId_decision_occurredAt_idx" ON "AiDecisionLog"("websiteId", "decision", "occurredAt");
CREATE INDEX "AiDecisionLog_websiteId_generatedPopupType_occurredAt_idx" ON "AiDecisionLog"("websiteId", "generatedPopupType", "occurredAt");
CREATE INDEX "AiDecisionLog_websiteId_sessionId_occurredAt_idx" ON "AiDecisionLog"("websiteId", "sessionId", "occurredAt");

ALTER TABLE "AiDecisionLog" ADD CONSTRAINT "AiDecisionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDecisionLog" ADD CONSTRAINT "AiDecisionLog_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
