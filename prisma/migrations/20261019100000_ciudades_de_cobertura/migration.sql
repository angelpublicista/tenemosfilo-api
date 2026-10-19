-- La ciudad donde se presta una experiencia a domicilio es de la publicacion,
-- no de la ficha.
--
-- Un chef que va a casa del cliente puede atender Bogota, Medellin y Cali, y
-- `Experience.presentialCity` solo guardaba una. Como el precio, el aforo y el
-- horario, la cobertura cambia segun donde se ofrece, asi que vive en
-- `LocationListing`: una lista de ciudades por publicacion.

-- 1. La lista. Vacia hasta que alguien la llene.
ALTER TABLE "LocationListing" ADD COLUMN "cities" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 2. Lo que ya habia: la ciudad de cada experiencia a domicilio pasa a ser la
--    primera zona de su publicacion. Si la publicacion ya existe se rellena;
--    si no, se crea con la sede nula, que es como se guarda la de a domicilio.
UPDATE "LocationListing" l
SET "cities" = ARRAY[btrim(e."presentialCity")]
FROM "Experience" e
WHERE l."experienceId" = e."id"
  AND l."locationId" IS NULL
  AND l."deletedAt" IS NULL
  AND e."atHome" = true
  AND e."deletedAt" IS NULL
  AND nullif(btrim(e."presentialCity"), '') IS NOT NULL;

INSERT INTO "LocationListing" ("id", "experienceId", "locationId", "cities", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  e."id",
  NULL,
  ARRAY[btrim(e."presentialCity")],
  NOW(),
  NOW()
FROM "Experience" e
WHERE e."atHome" = true
  AND e."deletedAt" IS NULL
  AND nullif(btrim(e."presentialCity"), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "LocationListing" l
    WHERE l."experienceId" = e."id" AND l."locationId" IS NULL AND l."deletedAt" IS NULL
  );
