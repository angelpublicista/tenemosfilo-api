-- Corrige los cupos que la migracion anterior escribio de menos.
--
-- `20261007170000_cupos_en_la_franja` mezclaba dos fuentes en el mismo LEAST:
-- las experiencias del horario y las de su sede. Como en produccion las cuatro
-- experiencias comparten sede, el minimo de TODAS se escribio en horarios que
-- tenian su propia experiencia: la cena de maridaje quedo con 12 cupos cuando
-- su aforo era 20, y la ruta de sabores con 12 cuando era 15.
--
-- Aqui manda lo que el horario tiene atado: si un horario cuelga de una
-- experiencia concreta, sus cupos son los de ESA experiencia. Solo se tocan
-- esos horarios; los de sede se quedaron bien.

WITH propias AS (
  -- A es la Availability y B la Experience: Prisma ordena los lados de la
  -- relacion implicita alfabeticamente.
  SELECT a."id" AS horario, MIN(e."capacity") AS cupos
  FROM "Availability" a
  JOIN "_ExperienceAvailabilities" ea ON ea."A" = a."id"
  JOIN "Experience" e ON e."id" = ea."B" AND e."deletedAt" IS NULL
  WHERE a."deletedAt" IS NULL AND e."capacity" IS NOT NULL
  GROUP BY a."id"
)
UPDATE "Availability" a
SET "weeklySchedule" = (
  SELECT jsonb_object_agg(
    dia.clave,
    CASE
      WHEN jsonb_typeof(dia.valor -> 'franjas') = 'array' THEN
        jsonb_set(
          dia.valor,
          '{franjas}',
          (
            SELECT COALESCE(jsonb_agg(f || jsonb_build_object('cupos', propias.cupos)), '[]'::jsonb)
            FROM jsonb_array_elements(dia.valor -> 'franjas') AS f
          )
        )
      ELSE dia.valor
    END
  )
  FROM jsonb_each(a."weeklySchedule"::jsonb) AS dia(clave, valor)
)::json
FROM propias
WHERE propias.horario = a."id"
  AND a."deletedAt" IS NULL
  AND jsonb_typeof(a."weeklySchedule"::jsonb) = 'object';
