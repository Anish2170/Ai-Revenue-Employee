-- Additive only. Existing jobs retain their strict default behavior.
ALTER TABLE "KnowledgeBuild" ADD COLUMN "configuration" JSONB;
