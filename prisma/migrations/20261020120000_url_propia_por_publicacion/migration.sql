-- Cada publicacion (una experiencia en una sede, o a domicilio) tiene su
-- propia URL en el catalogo: /book/<empresa>/<slug> y /r/<revendedor>/<slug>.
--
-- El slug es de la publicacion y no se vuelve a calcular: si despues cambia el
-- nombre de la experiencia o de la sede, el enlace que ya se compartio sigue
-- abriendo lo mismo.

ALTER TABLE "LocationListing" ADD COLUMN "slug" TEXT;

-- 1. Una experiencia conectada a una sede puede no tener fila de condiciones
--    (la fila solo existe cuando la sede cambia algo). Sin fila no habria donde
--    guardar el slug, asi que se crean las que faltan. Con todos los campos
--    nulos y publicada, que es exactamente lo que ya se comportaba.
INSERT INTO "LocationListing" ("id", "experienceId", "locationId", "cities", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, el."A", el."B", ARRAY[]::TEXT[], NOW(), NOW()
FROM "_ExperienceLocations" el
JOIN "Experience" e ON e."id" = el."A" AND e."deletedAt" IS NULL
JOIN "Location" l ON l."id" = el."B" AND l."deletedAt" IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "LocationListing" x
  WHERE x."experienceId" = el."A" AND x."locationId" = el."B"
);

-- 2. El slug de las que ya existen: <experiencia>-<sede>, o
--    <experiencia>-a-domicilio. Si dos salen iguales, la segunda lleva -2.
WITH base AS (
  SELECT
    li."id",
    li."createdAt",
    left(
      e."slug" || '-' || COALESCE(
        NULLIF(
          trim(both '-' from regexp_replace(
            lower(translate(loc."name", 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
            '[^a-z0-9]+', '-', 'g'
          )),
          ''
        ),
        CASE WHEN li."locationId" IS NULL THEN 'a-domicilio' ELSE 'sede' END
      ),
      110
    ) AS s
  FROM "LocationListing" li
  JOIN "Experience" e ON e."id" = li."experienceId"
  LEFT JOIN "Location" loc ON loc."id" = li."locationId"
  WHERE li."locationId" IS NOT NULL
  UNION ALL
  SELECT li."id", li."createdAt", left(e."slug" || '-a-domicilio', 110)
  FROM "LocationListing" li
  JOIN "Experience" e ON e."id" = li."experienceId"
  WHERE li."locationId" IS NULL
),
numeradas AS (
  SELECT "id", s, row_number() OVER (PARTITION BY s ORDER BY "createdAt", "id") AS n
  FROM base
)
UPDATE "LocationListing" li
SET "slug" = CASE WHEN n.n > 1 THEN n.s || '-' || n.n ELSE n.s END
FROM numeradas n
WHERE li."id" = n."id";

CREATE UNIQUE INDEX "LocationListing_slug_key" ON "LocationListing"("slug");
