CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "limiter" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RateLimitBucket_limiter_bucket_idx" ON "RateLimitBucket"("limiter", "bucket");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
