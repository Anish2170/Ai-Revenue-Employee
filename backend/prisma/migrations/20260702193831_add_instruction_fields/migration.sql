-- AlterTable
ALTER TABLE "BusinessInstruction" ADD COLUMN     "context" TEXT,
ADD COLUMN     "fallbackMessage" TEXT,
ADD COLUMN     "goal" TEXT,
ADD COLUMN     "role" TEXT,
ADD COLUMN     "rules" TEXT;
