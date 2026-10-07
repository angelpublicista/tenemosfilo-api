-- Pausar es de la publicacion, no de la experiencia.
--
-- La misma pieza puede seguir vendiendose en el local mientras la finca
-- descansa en temporada baja. Un estado unico en la ficha obligaba a elegir
-- todo o nada, asi que `ExperienceStatus` pierde PAUSED.
--
-- Y una experiencia a domicilio tambien tiene publicacion: no hay sede, pero
-- si hay algo puesto a la venta, con sus condiciones y su pausa. Por eso
-- `LocationListing.locationId` pasa a ser nulo.

-- 1. La sede de una publicacion puede faltar: es el caso de a domicilio.
ALTER TABLE "LocationListing" ALTER COLUMN "locationId" DROP NOT NULL;

-- 2. Lo que estaba pausado como experiencia pasa a estarlo como publicacion.
--    Una por cada sede donde se ofrece; si no tiene ninguna —a domicilio— una
--    con la sede nula. Se respeta lo que ya hubiera declarado la sede.
INSERT INTO "LocationListing" ("id", "experienceId", "locationId", "isPublished", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  e."id",
  l."B",
  false,
  NOW(),
  NOW()
FROM "Experience" e
JOIN "_ExperienceLocations" l ON l."A" = e."id"
WHERE e."status" = 'PAUSED'
  AND e."deletedAt" IS NULL
ON CONFLICT ("experienceId", "locationId") DO UPDATE SET "isPublished" = false;

INSERT INTO "LocationListing" ("id", "experienceId", "locationId", "isPublished", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, e."id", NULL, false, NOW(), NOW()
FROM "Experience" e
WHERE e."status" = 'PAUSED'
  AND e."deletedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "_ExperienceLocations" l WHERE l."A" = e."id");

UPDATE "Experience" SET "status" = 'ACTIVE' WHERE "status" = 'PAUSED';

-- 3. El estado pierde PAUSED. Ya no queda ninguna fila con ese valor.
ALTER TYPE "ExperienceStatus" RENAME TO "ExperienceStatus_viejo";
CREATE TYPE "ExperienceStatus" AS ENUM ('DRAFT', 'PENDING', 'ACTIVE', 'INACTIVE');
ALTER TABLE "Experience" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Experience"
  ALTER COLUMN "status" TYPE "ExperienceStatus"
  USING ("status"::text::"ExperienceStatus");
ALTER TABLE "Experience" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ExperienceStatus_viejo";
