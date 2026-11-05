ALTER TABLE "Website" ADD COLUMN "knowledgeRefreshHours" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "KnowledgeSource" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "websiteId" UUID NOT NULL,
  "origin" TEXT NOT NULL, "key" TEXT NOT NULL, "kind" TEXT NOT NULL, "url" TEXT,
  "title" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true, "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'READY', "content" TEXT NOT NULL DEFAULT '', "contentHash" TEXT NOT NULL DEFAULT '',
  "chunks" JSONB NOT NULL DEFAULT '[]', "embeddingModel" TEXT NOT NULL DEFAULT '',
  "pendingContent" TEXT, "pendingFile" TEXT, "fileName" TEXT, "error" TEXT, "revision" INTEGER NOT NULL DEFAULT 0,
  "leaseToken" TEXT, "leaseExpiresAt" TIMESTAMP(3), "checkedAt" TIMESTAMP(3), "publishedAt" TIMESTAMP(3),
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3), CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSource_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "KnowledgeSource_websiteId_origin_key_key" ON "KnowledgeSource"("websiteId", "origin", "key");
CREATE INDEX "KnowledgeSource_status_nextCheckAt_idx" ON "KnowledgeSource"("status", "nextCheckAt");
CREATE INDEX "KnowledgeSource_websiteId_origin_idx" ON "KnowledgeSource"("websiteId", "origin");
