-- Horario semanal de la sede.
--
-- Un tramo por dia: { mon: { isOpen, from, to }, tue: {...}, ... }. Se usan
-- las mismas claves de dia que Availability.weeklySchedule para no tener dos
-- vocabularios de dias en la misma base.
--
-- La forma es mas simple que la de Availability a proposito: alli hay varios
-- tramos por dia porque son huecos de reserva; aqui es sencillamente cuando
-- abre el local.
--
-- Una sola columna aunque signifique dos cosas: horario de atencion si la sede
-- esta abierta al publico, y horario disponible para eventos si no. El dato es
-- el mismo —cuando se puede estar ahi— y guardarlo dos veces solo daria
-- ocasion de que se contradigan.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "openingHours" JSONB;
