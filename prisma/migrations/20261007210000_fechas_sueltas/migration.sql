-- Lo que pasa en una fecha concreta, por encima del patron semanal.
--
-- Un dia suelto se cierra —el 24 no se abre aunque sea jueves— o se abre con
-- otras franjas —el 31 solo la cena, con mas cupos—. Antes solo se podia
-- cerrar, y ni eso se comprobaba al vender.
--
-- Mismo formato que un dia de `weeklySchedule`: { isActive, franjas? }.
--
-- `blockedDates` se vuelca aqui y se borra en el siguiente despliegue. En
-- produccion no hay ninguna, asi que el volcado es por si acaso.

ALTER TABLE "Availability" ADD COLUMN "dateOverrides" JSONB;

UPDATE "Availability" a
SET "dateOverrides" = (
  SELECT jsonb_object_agg(fecha, jsonb_build_object('isActive', false))
  FROM unnest(a."blockedDates") AS fecha
)
WHERE array_length(a."blockedDates", 1) > 0;
