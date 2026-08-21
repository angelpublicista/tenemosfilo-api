-- AlterTable
ALTER TABLE "Company" ADD COLUMN "embedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
