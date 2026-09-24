-- Capacidad de la sede y si esta abierta al publico.
--
-- La capacidad era un Json { minGuests, maxGuests }. El minimo se va: no es de
-- la sede sino de cada experiencia —un salon no tiene un minimo de personas,
-- una cena maridaje si—. Y quitado el minimo, un Json de una sola clave solo
-- servia para esconderla de las consultas.
--
-- El maximo se conserva: se copia a la columna nueva ANTES de tirar el Json.
-- Todo va en la misma transaccion, asi que si la copia fallara no se perderia
-- nada: se revierte entera y la migracion falla en vez de dejar sedes sin
-- capacidad.
--
-- isPublic queda NULL en las sedes que ya existen. No se asume ni true ni
-- false: ninguna de las dos es mas probable, e inventarlo seria dar por
-- declarado algo que nadie declaro.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "maxCapacity" INTEGER,
ADD COLUMN     "isPublic" BOOLEAN;

-- Conservar el maximo que ya estaba guardado.
UPDATE "Location"
   SET "maxCapacity" = NULLIF(("capacity"->>'maxGuests'), '')::INTEGER
 WHERE "capacity" IS NOT NULL
   AND jsonb_typeof(("capacity"::jsonb)->'maxGuests') = 'number';

-- AlterTable
ALTER TABLE "Location" DROP COLUMN "capacity";
