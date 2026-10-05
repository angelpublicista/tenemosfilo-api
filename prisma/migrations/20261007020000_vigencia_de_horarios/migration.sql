-- TR-35. Desde y hasta cuando se repite un horario semanal.
--
-- Sin fecha de corte, un horario genera inventario para siempre: en 2031 se
-- podria reservar un sabado que nadie decidio abrir.
ALTER TABLE "Availability" ADD COLUMN "validFrom" TIMESTAMP(3);
ALTER TABLE "Availability" ADD COLUMN "validUntil" TIMESTAMP(3);

-- Los horarios que ya existian empiezan el dia en que se crearon. La fecha
-- final se deja nula a proposito: significa "sin fecha final", que es lo que
-- hacen hoy, y ponerles una inventada les cerraria la agenda sin que nadie
-- lo hubiera pedido.
UPDATE "Availability" SET "validFrom" = "createdAt" WHERE "validFrom" IS NULL;
