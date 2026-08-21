-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "filoCommissionType" "CommissionType" NOT NULL DEFAULT 'PERCENT',
    "filoCommissionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "resellerCommissionType" "CommissionType" NOT NULL DEFAULT 'PERCENT',
    "resellerCommissionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Experience" ADD COLUMN     "filoCommissionType" "CommissionType",
ADD COLUMN     "filoCommissionValue" DECIMAL(12,2),
ADD COLUMN     "resellerCommissionType" "CommissionType",
ADD COLUMN     "resellerCommissionValue" DECIMAL(12,2);
