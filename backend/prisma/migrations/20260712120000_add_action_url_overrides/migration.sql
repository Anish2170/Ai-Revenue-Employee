CREATE TABLE "ActionUrlOverride" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "intent" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionUrlOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActionUrlOverride_websiteId_intent_key" ON "ActionUrlOverride"("websiteId", "intent");
CREATE INDEX "ActionUrlOverride_organizationId_idx" ON "ActionUrlOverride"("organizationId");
CREATE INDEX "ActionUrlOverride_websiteId_idx" ON "ActionUrlOverride"("websiteId");

ALTER TABLE "ActionUrlOverride" ADD CONSTRAINT "ActionUrlOverride_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionUrlOverride" ADD CONSTRAINT "ActionUrlOverride_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;