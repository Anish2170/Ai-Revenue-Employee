-- PostgreSQL requires new enum labels to be committed before they are referenced.
ALTER TYPE "BuildStatus" ADD VALUE IF NOT EXISTS 'QUEUED';
ALTER TYPE "BuildStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT';
ALTER TYPE "BuildStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
