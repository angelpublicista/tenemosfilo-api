-- Pre-reserva, cobro y cierre de la venta.
--
-- PRE_RESERVED es un estado mas de la reserva, no una tabla aparte: lo que
-- bloquea el espacio es el conteo de aforo, que excluye solo CANCELLED y
-- NO_SHOW. Siendo un estado, bloquea sin tocar esa logica. Y NO caduca sola:
-- se queda hasta que la venta se confirme o se pierda.
--
-- `paidAmount` hace falta porque `paymentStatus` dice si esta pagada pero no
-- cuanto, y sin el monto no hay forma de comprobar un abono del 50%.
--
-- `paymentConditionNote` guarda lo acordado cuando se acepta algo distinto al
-- abono —una orden de compra— junto a quien lo autorizo. Saltarse el minimo
-- tiene que dejar rastro de quien decidio saltarselo.

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'PRE_RESERVED' BEFORE 'PENDING';

-- AlterEnum
ALTER TYPE "FollowupKind" ADD VALUE IF NOT EXISTS 'PAGO_PENDIENTE';

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "opportunityId" TEXT;

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "paymentInstructionsSentAt" TIMESTAMP(3),
ADD COLUMN     "paymentConditionNote" TEXT,
ADD COLUMN     "paymentConditionById" TEXT;

-- CreateIndex
CREATE INDEX "Reservation_opportunityId_idx" ON "Reservation"("opportunityId");

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_paymentConditionById_fkey" FOREIGN KEY ("paymentConditionById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
