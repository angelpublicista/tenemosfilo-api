-- Los cupos pasan de la experiencia a la franja.
--
-- El aforo es del horario, no de la pieza: el almuerzo y la cena de un sabado
-- son dos inventarios distintos, y la misma experiencia puede admitir ocho en
-- el local y veinte en la terraza. Con un numero unico en la experiencia,
-- decir "los sabados por la noche caben menos" no se podia expresar.
--
-- Esta migracion RELLENA: a cada franja que no declara cupos le escribe el
-- aforo de la experiencia a la que sirve ese horario. Si sirve a varias, el
-- MENOR de ellas: es el unico que no promete sitio que alguna no tiene.
--
-- Las columnas `Experience.capacity` y `LocationListing.capacity` se borran en
-- el siguiente despliegue; aqui solo se deja de usarlas.

WITH aforo AS (
  -- Lo que cabe segun el horario: el de sus experiencias, o el de las
  -- experiencias de su sede cuando el horario es de la sede.
  SELECT
    a."id" AS horario,
    LEAST(
      MIN(e_propia."capacity"),
      MIN(e_sede."capacity")
    ) AS cupos
  FROM "Availability" a
  LEFT JOIN "_ExperienceAvailabilities" ea ON ea."A" = a."id" OR ea."B" = a."id"
  LEFT JOIN "Experience" e_propia
    ON e_propia."id" IN (ea."A", ea."B") AND e_propia."id" <> a."id" AND e_propia."deletedAt" IS NULL
  LEFT JOIN "_ExperienceLocations" el ON el."B" = a."locationId" OR el."A" = a."locationId"
  LEFT JOIN "Experience" e_sede
    ON e_sede."id" IN (el."A", el."B") AND e_sede."id" <> a."locationId" AND e_sede."deletedAt" IS NULL
  WHERE a."deletedAt" IS NULL
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
            SELECT COALESCE(jsonb_agg(
              CASE
                WHEN f ? 'cupos' AND f -> 'cupos' <> 'null'::jsonb THEN f
                ELSE f || jsonb_build_object('cupos', aforo.cupos)
              END
            ), '[]'::jsonb)
            FROM jsonb_array_elements(dia.valor -> 'franjas') AS f
          )
        )
      ELSE dia.valor
    END
  )
  FROM jsonb_each(a."weeklySchedule"::jsonb) AS dia(clave, valor)
)::json
FROM aforo
WHERE aforo.horario = a."id"
  AND aforo.cupos IS NOT NULL
  AND a."deletedAt" IS NULL
  AND jsonb_typeof(a."weeklySchedule"::jsonb) = 'object';
