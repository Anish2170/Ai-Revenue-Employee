-- CreateEnum
CREATE TYPE "LeadScoreLabel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "visitorId" TEXT,
    "sessionId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "interest" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "scorePercent" INTEGER NOT NULL,
    "scoreLabel" "LeadScoreLabel" NOT NULL,
    "reason" TEXT NOT NULL,
    "lastQuestion" TEXT,
    "pagesVisited" JSONB NOT NULL DEFAULT '[]',
    "suggestedNextAction" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_organizationId_capturedAt_idx" ON "Lead"("organizationId", "capturedAt");

-- CreateIndex
CREATE INDEX "Lead_websiteId_capturedAt_idx" ON "Lead"("websiteId", "capturedAt");

-- CreateIndex
CREATE INDEX "Lead_conversationId_idx" ON "Lead"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_conversationId_email_key" ON "Lead"("conversationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_conversationId_phone_key" ON "Lead"("conversationId", "phone");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;