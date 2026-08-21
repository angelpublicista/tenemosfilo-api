-- Distribucion de experiencias en canales externos.
--
-- La ficha del canal no se guarda: se genera desde la experiencia cada vez.
-- Aqui solo vive lo que el canal sabe y FILO no (donde quedo publicada).
CREATE TYPE "ChannelType" AS ENUM ('OPENTABLE');
CREATE TYPE "ChannelListingStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'UNPUBLISHED');

ALTER TABLE "Company" ADD COLUMN "openTableRid" TEXT;

CREATE TABLE "ChannelListing" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "channel" "ChannelType" NOT NULL,
    "status" "ChannelListingStatus" NOT NULL DEFAULT 'DRAFT',
    "externalUrl" TEXT,
    "externalId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChannelListing_pkey" PRIMARY KEY ("id")
);

-- Una experiencia no puede estar dos veces en el mismo canal.
CREATE UNIQUE INDEX "ChannelListing_experienceId_channel_key" ON "ChannelListing"("experienceId", "channel");
CREATE INDEX "ChannelListing_companyId_channel_idx" ON "ChannelListing"("companyId", "channel");

ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChannelListing" ADD CONSTRAINT "ChannelListing_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
