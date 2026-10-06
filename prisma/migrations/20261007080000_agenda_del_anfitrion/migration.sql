-- TR-21. La agenda propia del anfitrion.
--
-- Hasta ahora un horario solo existia colgado de una sede o de una
-- experiencia, asi que la agenda del anfitrion no se podia expresar: un
-- cocinero que va a casa del cliente no tiene sede, y su calendario no es de
-- ninguna experiencia en particular.
ALTER TABLE "Availability" ADD COLUMN "companyId" TEXT;

CREATE INDEX "Availability_companyId_idx" ON "Availability"("companyId");

ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Los que ya existen se quedan con su dueño explicito: la empresa de su sede,
-- o la de la primera experiencia a la que esten atados. Asi las consultas por
-- empresa no tienen que seguir pasando por dos tablas.
UPDATE "Availability" a
SET "companyId" = l."companyId"
FROM "Location" l
WHERE a."locationId" = l."id" AND a."companyId" IS NULL;

UPDATE "Availability" a
SET "companyId" = e."companyId"
FROM "_ExperienceAvailabilities" ea
JOIN "Experience" e ON e."id" = ea."A"
WHERE ea."B" = a."id" AND a."companyId" IS NULL;
