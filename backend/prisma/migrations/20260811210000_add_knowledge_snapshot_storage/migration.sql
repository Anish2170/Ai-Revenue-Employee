-- Durable snapshot artifact metadata. Existing local snapshots remain readable.
CREATE TYPE "KnowledgeStorageProvider" AS ENUM ('LOCAL', 'R2');

ALTER TABLE "KnowledgeSnapshot"
  ADD COLUMN "storageProvider" "KnowledgeStorageProvider" NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentBytes" INTEGER,
  ADD COLUMN "etag" TEXT;
