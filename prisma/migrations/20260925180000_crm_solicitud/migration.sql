-- Clasificacion comercial de la solicitud, origen del lead y union de la
-- cotizacion con la oportunidad.
--
-- experienceKind es la PRIMERA decision de una solicitud: de ella dependen el
-- tipo de comprador, si puede haber pre-reserva y que hace falta para dar la
-- venta por cerrada.
--
-- buyerKind clasifica al COMPRADOR, no a la experiencia. Una abierta siempre
-- se le vende a un particular —el API lo fija solo—; una privada puede ser de
-- particular o de empresa, y ahi si hay que elegir.
--
-- Los dos quedan NULL en las oportunidades que ya existen: nadie las
-- clasifico y no se les inventa una clasificacion.
--
-- La cotizacion pasa a colgar de la oportunidad. Hasta ahora vivia suelta, y
-- por eso habia que volver a teclear lo que ya estaba en la solicitud. Es
-- opcional: las cotizaciones que ya existen no tienen oportunidad detras.
-- SET NULL al borrar la oportunidad, para no llevarse el historial comercial.

-- CreateEnum
CREATE TYPE "ExperienceKind" AS ENUM ('ABIERTA', 'PRIVADA');
CREATE TYPE "BuyerKind" AS ENUM ('SOCIAL', 'CORPORATIVO');
CREATE TYPE "LeadSource" AS ENUM ('WHATSAPP', 'INSTAGRAM', 'WEB', 'REFERIDO', 'PROSPECCION', 'RESELLER', 'OTRO');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "experienceKind" "ExperienceKind",
ADD COLUMN     "buyerKind" "BuyerKind",
ADD COLUMN     "leadSource" "LeadSource",
ADD COLUMN     "leadSourceDetail" TEXT;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "opportunityId" TEXT;

-- CreateIndex
CREATE INDEX "Quote_opportunityId_idx" ON "Quote"("opportunityId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
