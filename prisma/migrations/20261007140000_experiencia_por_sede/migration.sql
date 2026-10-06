-- La experiencia en cada sede.
--
-- Una experiencia es una pieza con la que se arma el catalogo: la misma puede
-- estar en una sede como abierta y en otra como privada, con otro aforo, otro
-- precio y otra anticipacion. La tabla es OPCIONAL: sin fila manda lo que diga
-- la experiencia, asi que nada de lo que ya existe cambia de comportamiento.
--
-- No se rellena nada: las 4 experiencias en produccion tienen una sola sede y
-- ninguna condicion propia que declarar.

-- CreateTable
CREATE TABLE "LocationListing" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "kind" "ExperienceKind",
    "capacity" INTEGER,
    "minCapacity" INTEGER,
    "basePrice" DECIMAL(12,2),
    "prepTime" INTEGER,
    "cleanupTime" INTEGER,
    "minimumNotice" INTEGER,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LocationListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationListing_locationId_idx" ON "LocationListing"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationListing_experienceId_locationId_key" ON "LocationListing"("experienceId", "locationId");

-- AddForeignKey
ALTER TABLE "LocationListing" ADD CONSTRAINT "LocationListing_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationListing" ADD CONSTRAINT "LocationListing_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
