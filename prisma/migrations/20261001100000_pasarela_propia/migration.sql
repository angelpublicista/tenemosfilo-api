-- Pasarela de pagos propia del anfitrion.
--
-- Hasta ahora el dinero entraba SIEMPRE a la cuenta de FILO, que descontaba
-- su comision y la del revendedor y despues dispersaba. Con pasarela propia
-- el cliente le paga directamente al anfitrion: FILO no toca ese dinero y por
-- eso no cobra comision sobre el.
--
-- `collectedBy` se congela en cada reserva y no se deduce de la empresa al
-- consultarla. Un anfitrion puede conectar o desconectar su pasarela cuando
-- quiera, y si el reparto se recalculara, una reserva vieja cambiaria de
-- dueño el dia que toque un ajuste. Lo que importa es quien cobro ESE dia.
--
-- `Payout.payerCompanyId` aparece porque ahora hay dos direcciones de pago.
-- Antes solo pagaba FILO; con cobro directo, la comision del revendedor la
-- debe el anfitrion, que es quien recibio el dinero. NULL sigue siendo FILO,
-- que es lo que eran todas las filas existentes.
--
-- Los secretos de la pasarela se guardan cifrados (AES-256-GCM). Son las
-- credenciales de cobro de terceros: una copia de la base no puede ser
-- suficiente para cobrar en nombre de ningun anfitrion.

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('WOMPI', 'MERCADO_PAGO');

-- CreateEnum
CREATE TYPE "PaymentEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "CollectedBy" AS ENUM ('PLATFORM', 'HOST');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "paymentProvider" "PaymentProvider",
ADD COLUMN     "paymentGatewayEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentEnvironment" "PaymentEnvironment" NOT NULL DEFAULT 'SANDBOX',
ADD COLUMN     "gatewayPublicKey" TEXT,
ADD COLUMN     "gatewayPrivateKey" TEXT,
ADD COLUMN     "gatewayIntegritySecret" TEXT,
ADD COLUMN     "gatewayEventsSecret" TEXT;

-- AlterTable
-- Las reservas que ya existen las cobro FILO: es literalmente lo que paso.
ALTER TABLE "Reservation" ADD COLUMN     "collectedBy" "CollectedBy" NOT NULL DEFAULT 'PLATFORM';

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "payerCompanyId" TEXT;

-- CreateIndex
CREATE INDEX "Payout_payerCompanyId_idx" ON "Payout"("payerCompanyId");

-- CreateIndex
CREATE INDEX "Reservation_collectedBy_idx" ON "Reservation"("collectedBy");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_payerCompanyId_fkey" FOREIGN KEY ("payerCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
