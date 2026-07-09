CREATE TYPE "ConversationTitleSource" AS ENUM ('AUTO', 'MANUAL');
CREATE TYPE "ConversationTitleStatus" AS ENUM ('PENDING', 'READY', 'SKIPPED', 'FAILED');
CREATE TYPE "ConversationMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "Conversation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "websiteId" UUID NOT NULL,
  "visitorId" TEXT,
  "sessionId" TEXT,
  "title" TEXT NOT NULL DEFAULT 'New Chat',
  "titleSource" "ConversationTitleSource" NOT NULL DEFAULT 'AUTO',
  "titleStatus" "ConversationTitleStatus" NOT NULL DEFAULT 'PENDING',
  "titleGeneratedAt" TIMESTAMP(3),
  "firstUserMessage" TEXT,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "conversationId" UUID NOT NULL,
  "role" "ConversationMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "sourceTitle" TEXT,
  "sourceUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Conversation_organizationId_lastMessageAt_idx" ON "Conversation"("organizationId", "lastMessageAt");
CREATE INDEX "Conversation_websiteId_lastMessageAt_idx" ON "Conversation"("websiteId", "lastMessageAt");
CREATE INDEX "Conversation_websiteId_sessionId_idx" ON "Conversation"("websiteId", "sessionId");
CREATE INDEX "Conversation_titleStatus_titleSource_idx" ON "Conversation"("titleStatus", "titleSource");
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;