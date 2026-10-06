-- Fuera lo virtual.
--
-- Todo es presencial. El tipo VIRTUAL/HYBRID no se usaba —cero experiencias y
-- cero reservas en produccion— y lo que de verdad distingue dos negocios es si
-- el anfitrion va a casa de quien reserva, que es lo que dice `atHome`.
--
-- SEGUNDO PASO de dos. El codigo dejo de leer y escribir estas columnas en el
-- despliegue anterior (793a9f2), que ya esta sirviendo; por eso se pueden
-- borrar ahora sin tumbar nada en el aire.
--
-- No se pierde informacion: las columnas estaban vacias o con el valor por
-- defecto en todas las filas.

ALTER TABLE "Experience" DROP COLUMN "experienceType";
ALTER TABLE "Experience" DROP COLUMN "isVirtual";
ALTER TABLE "Experience" DROP COLUMN "virtualPlatform";

ALTER TABLE "Reservation" DROP COLUMN "isVirtual";
ALTER TABLE "Reservation" DROP COLUMN "virtualDetails";

-- El tipo ya no lo usa ninguna columna.
DROP TYPE "ExperienceType";
