ALTER TABLE "AiDecisionLog"
  ADD COLUMN "expectedAction" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "primaryActionReturned" TEXT,
  ADD COLUMN "fallbackApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fallbackUsed" TEXT,
  ADD COLUMN "missingActionReason" TEXT;
