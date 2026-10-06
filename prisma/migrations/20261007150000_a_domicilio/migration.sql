-- A domicilio: donde ocurre la experiencia.
--
-- Un chef que va a casa del cliente no tiene sede donde publicarse: la
-- direccion la pone quien reserva y cambia en cada reserva. `atHome` lo dice
-- en la experiencia y `serviceAddress` guarda la direccion de cada reserva.
--
-- Solo se AÑADE. Las columnas de lo virtual —experienceType, isVirtual,
-- virtualPlatform, Reservation.isVirtual y virtualDetails— se borran en el
-- siguiente despliegue: la migracion corre con el codigo viejo todavia
-- sirviendo, y quitarlas ahora tumbaria lo que esta en el aire.
--
-- No se rellena nada: en produccion no hay ni una experiencia virtual ni una
-- reserva virtual, asi que todo queda a domicilio = false, que es lo correcto.

-- AlterTable
ALTER TABLE "Experience" ADD COLUMN     "atHome" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "serviceAddress" TEXT;

-- CreateIndex
CREATE INDEX "Availability_locationId_idx" ON "Availability"("locationId");
