-- Franjas horarias con cupos, y el aviso minimo en la experiencia.
--
-- 1) `timeSlots` pasa a llamarse `franjas` dentro de `weeklySchedule`: es el
--    nombre que se usa en el producto, y tener dos palabras para lo mismo
--    —una en pantalla y otra en los datos— es como empiezan las confusiones
--    al leer un JSON seis meses despues.
--
-- 2) `minimumNotice` se muda del horario a la experiencia: la anticipacion
--    que necesita una cena de quince personas es de la cena, no del sabado.
--    Se toma la mas exigente de los horarios que la sirven, que es la regla
--    con la que ya se calculaba al vender.
--
-- 3) El viejo `bufferTime` del horario se funde en `prepTime` de la
--    experiencia: era lo mismo visto desde el otro lado —"tiempo entre
--    reservas"— y la ocupacion ya se calcula como preparacion + duracion +
--    limpieza. Solo se copia donde la experiencia no tenga ya su propia
--    preparacion: lo que el anfitrion escribio a mano manda.

ALTER TABLE "Experience" ADD COLUMN "minimumNotice" INTEGER;

-- El aviso minimo: el mayor de sus horarios propios.
UPDATE "Experience" e
SET "minimumNotice" = sub.maximo
FROM (
  SELECT ea."A" AS experience_id, MAX(a."minimumNotice") AS maximo
  FROM "_ExperienceAvailabilities" ea
  JOIN "Availability" a ON a."id" = ea."B"
  WHERE a."deletedAt" IS NULL AND a."isActive" = true
  GROUP BY ea."A"
) sub
WHERE e."id" = sub.experience_id AND sub.maximo > 0;

-- Las que no tienen horario propio heredan el de su sede.
UPDATE "Experience" e
SET "minimumNotice" = sub.maximo
FROM (
  SELECT el."A" AS experience_id, MAX(a."minimumNotice") AS maximo
  FROM "_ExperienceLocations" el
  JOIN "Availability" a ON a."locationId" = el."B"
  WHERE a."deletedAt" IS NULL AND a."isActive" = true
  GROUP BY el."A"
) sub
WHERE e."id" = sub.experience_id AND e."minimumNotice" IS NULL AND sub.maximo > 0;

-- La preparacion: el buffer del horario, solo si la experiencia no tiene ya
-- la suya puesta a mano.
UPDATE "Experience" e
SET "prepTime" = sub.maximo
FROM (
  SELECT ea."A" AS experience_id, MAX(a."bufferTime") AS maximo
  FROM "_ExperienceAvailabilities" ea
  JOIN "Availability" a ON a."id" = ea."B"
  WHERE a."deletedAt" IS NULL AND a."isActive" = true
  GROUP BY ea."A"
) sub
WHERE e."id" = sub.experience_id AND e."prepTime" IS NULL AND sub.maximo > 0;

-- Y el renombre de las franjas, clave por clave de la semana.
UPDATE "Availability" a
SET "weeklySchedule" = (
  SELECT jsonb_object_agg(
    dia.clave,
    CASE
      WHEN dia.valor ? 'timeSlots'
        THEN (dia.valor - 'timeSlots') || jsonb_build_object('franjas', dia.valor -> 'timeSlots')
      ELSE dia.valor
    END
  )
  FROM jsonb_each(a."weeklySchedule"::jsonb) AS dia(clave, valor)
)
WHERE a."weeklySchedule" IS NOT NULL
  AND jsonb_typeof(a."weeklySchedule"::jsonb) = 'object'
  AND a."weeklySchedule"::jsonb <> '{}'::jsonb;
