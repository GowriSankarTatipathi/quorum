-- AlterTable
ALTER TABLE "Claim" ALTER COLUMN "confidence" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Verdict" ALTER COLUMN "confidence" DROP NOT NULL;
