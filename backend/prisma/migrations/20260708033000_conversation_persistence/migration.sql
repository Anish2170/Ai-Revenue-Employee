CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'ARCHIVED');

CREATE TABLE "Visitor" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "websiteId" UUID NOT NULL,
  "visitorId" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastConversationId" UUID,
  "currentPage" TEXT,
  "device" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Conversation" ADD COLUMN "visitorRecordId" UUID;
ALTER TABLE "Conversation" ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN';
ALTER TABLE "Conversation" ADD COLUMN "summary" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "summaryUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "summarizedMessageCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "totalMessages" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Conversation" ADD COLUMN "currentPage" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "device" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Conversation" ADD COLUMN "deletedAt" TIMESTAMP(3);

ALTER TABLE "ConversationMessage" ADD COLUMN "sourceMetadata" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ConversationMessage" ADD COLUMN "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "ConversationMessage" SET "timestamp" = "createdAt" WHERE "timestamp" IS NOT NULL;

UPDATE "Conversation" c
SET "totalMessages" = counts.count
FROM (
  SELECT "conversationId", COUNT(*)::INTEGER AS count
  FROM "ConversationMessage"
  GROUP BY "conversationId"
) counts
WHERE c."id" = counts."conversationId";

INSERT INTO "Visitor" ("organizationId", "websiteId", "visitorId", "firstSeenAt", "lastSeenAt", "lastConversationId", "currentPage", "device", "createdAt", "updatedAt")
SELECT
  c."organizationId",
  c."websiteId",
  c."visitorId",
  MIN(c."createdAt"),
  MAX(c."lastMessageAt"),
  (ARRAY_AGG(c."id" ORDER BY c."lastMessageAt" DESC))[1],
  (ARRAY_AGG(c."currentPage" ORDER BY c."lastMessageAt" DESC))[1],
  (ARRAY_AGG(c."device" ORDER BY c."lastMessageAt" DESC))[1],
  MIN(c."createdAt"),
  MAX(c."updatedAt")
FROM "Conversation" c
WHERE c."visitorId" IS NOT NULL
GROUP BY c."organizationId", c."websiteId", c."visitorId"
ON CONFLICT DO NOTHING;

UPDATE "Conversation" c
SET "visitorRecordId" = v."id"
FROM "Visitor" v
WHERE c."websiteId" = v."websiteId" AND c."visitorId" = v."visitorId";

CREATE TABLE "ConversationMemory" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "websiteId" UUID NOT NULL,
  "visitorId" TEXT,
  "kind" TEXT NOT NULL DEFAULT 'fact',
  "content" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMemory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Visitor_websiteId_visitorId_key" ON "Visitor"("websiteId", "visitorId");
CREATE INDEX "Visitor_organizationId_lastSeenAt_idx" ON "Visitor"("organizationId", "lastSeenAt");
CREATE INDEX "Visitor_websiteId_lastSeenAt_idx" ON "Visitor"("websiteId", "lastSeenAt");
CREATE INDEX "Conversation_websiteId_visitorId_lastMessageAt_idx" ON "Conversation"("websiteId", "visitorId", "lastMessageAt");
CREATE INDEX "Conversation_websiteId_status_lastMessageAt_idx" ON "Conversation"("websiteId", "status", "lastMessageAt");
CREATE INDEX "Conversation_deletedAt_idx" ON "Conversation"("deletedAt");
CREATE INDEX "ConversationMemory_conversationId_createdAt_idx" ON "ConversationMemory"("conversationId", "createdAt");
CREATE INDEX "ConversationMemory_websiteId_visitorId_idx" ON "ConversationMemory"("websiteId", "visitorId");
CREATE INDEX "ConversationMemory_organizationId_updatedAt_idx" ON "ConversationMemory"("organizationId", "updatedAt");

ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_visitorRecordId_fkey" FOREIGN KEY ("visitorRecordId") REFERENCES "Visitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationMemory" ADD CONSTRAINT "ConversationMemory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMemory" ADD CONSTRAINT "ConversationMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMemory" ADD CONSTRAINT "ConversationMemory_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;