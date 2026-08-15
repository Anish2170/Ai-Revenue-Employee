-- Durable PostgreSQL knowledge-build queue. Existing completed history is preserved.
ALTER TABLE "KnowledgeBuild"
  ADD COLUMN IF NOT EXISTS "lastErrorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "requestedByUserId" UUID,
  ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "language" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "lockedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "pagesSkipped" INTEGER,
  ADD COLUMN IF NOT EXISTS "actionsDiscovered" INTEGER,
  ADD COLUMN IF NOT EXISTS "embeddingsCompleted" INTEGER;

UPDATE "KnowledgeBuild"
SET "status" = 'RETRY_WAIT', "nextRunAt" = CURRENT_TIMESTAMP,
    "lastErrorCode" = 'DEPLOYMENT_RECOVERY',
    "error" = COALESCE("error", 'Recovered after deployment; queued for retry.')
WHERE "status" = 'RUNNING' AND "finishedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "KnowledgeBuild_status_nextRunAt_idx" ON "KnowledgeBuild"("status", "nextRunAt");
CREATE INDEX IF NOT EXISTS "KnowledgeBuild_status_leaseExpiresAt_idx" ON "KnowledgeBuild"("status", "leaseExpiresAt");
CREATE INDEX IF NOT EXISTS "KnowledgeBuild_websiteId_createdAt_idx" ON "KnowledgeBuild"("websiteId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeBuild_one_active_per_website"
  ON "KnowledgeBuild"("websiteId")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'RETRY_WAIT');
