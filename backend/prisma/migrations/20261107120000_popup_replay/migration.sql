CREATE TABLE "PopupReplayRunner" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "createdBy" UUID NOT NULL,
 "name" TEXT NOT NULL, "pairingHash" TEXT, "pairingExpiresAt" TIMESTAMP(3), "tokenHash" TEXT,
 "expiresAt" TIMESTAMP(3) NOT NULL, "lastSeenAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PopupReplayRunner_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PopupReplayRunner_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PopupReplayRunner_pairingHash_key" ON "PopupReplayRunner"("pairingHash");
CREATE UNIQUE INDEX "PopupReplayRunner_tokenHash_key" ON "PopupReplayRunner"("tokenHash");
CREATE INDEX "PopupReplayRunner_organizationId_createdAt_idx" ON "PopupReplayRunner"("organizationId", "createdAt");
CREATE TABLE "PopupReplayBatch" (
 "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "websiteId" UUID NOT NULL, "runnerId" UUID NOT NULL,
 "createdBy" UUID NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "budgetMicros" INTEGER NOT NULL DEFAULT 1000000, "reservedMicros" INTEGER NOT NULL DEFAULT 0,
 "externalCalls" INTEGER NOT NULL DEFAULT 0, "config" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PopupReplayBatch_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PopupReplayBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PopupReplayBatch_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "PopupReplayRunner"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PopupReplayBatch_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PopupReplayBatch_budget_check" CHECK ("budgetMicros" > 0 AND "budgetMicros" <= 1000000 AND "reservedMicros" >= 0 AND "reservedMicros" <= "budgetMicros")
);
CREATE INDEX "PopupReplayBatch_organizationId_createdAt_idx" ON "PopupReplayBatch"("organizationId", "createdAt");
CREATE INDEX "PopupReplayBatch_runnerId_status_idx" ON "PopupReplayBatch"("runnerId", "status");
CREATE TABLE "PopupReplayRun" (
 "id" UUID NOT NULL, "batchId" UUID NOT NULL, "ordinal" INTEGER NOT NULL, "scenario" TEXT NOT NULL,
 "surface" TEXT NOT NULL, "externalCalls" INTEGER NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'QUEUED', "leaseHash" TEXT, "leaseExpiresAt" TIMESTAMP(3),
 "visitorId" TEXT, "sessionId" TEXT, "trace" JSONB NOT NULL DEFAULT '[]', "result" JSONB,
 "screenshot" BYTEA, "rating" TEXT, "startedAt" TIMESTAMP(3), "finishedAt" TIMESTAMP(3),
 CONSTRAINT "PopupReplayRun_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "PopupReplayRun_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PopupReplayBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PopupReplayRun_visitorId_key" ON "PopupReplayRun"("visitorId");
CREATE UNIQUE INDEX "PopupReplayRun_sessionId_key" ON "PopupReplayRun"("sessionId");
CREATE UNIQUE INDEX "PopupReplayRun_batchId_ordinal_key" ON "PopupReplayRun"("batchId", "ordinal");
CREATE INDEX "PopupReplayRun_batchId_status_idx" ON "PopupReplayRun"("batchId", "status");
