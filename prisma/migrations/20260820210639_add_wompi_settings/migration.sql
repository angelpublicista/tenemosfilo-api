-- CreateEnum
CREATE TYPE "WompiEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- AlterTable
ALTER TABLE "PlatformSettings" ADD COLUMN     "wompiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "wompiEnvironment" "WompiEnvironment" NOT NULL DEFAULT 'SANDBOX',
ADD COLUMN     "wompiPublicKey" TEXT,
ADD COLUMN     "wompiPrivateKey" TEXT,
ADD COLUMN     "wompiIntegritySecret" TEXT,
ADD COLUMN     "wompiEventsSecret" TEXT;
