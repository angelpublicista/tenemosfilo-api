-- Condiciones importantes de la sede.
--
-- Un campo abierto y no veinte casillas mas. Las condiciones de un local
-- —restricciones de ruido, acceso de proveedores, horarios de montaje,
-- escaleras, restricciones de catering— son demasiado particulares para
-- anticiparlas, y una lista cerrada obligaria a ampliarla cada vez que
-- aparece una nueva, que es siempre.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "importantInfo" TEXT;
