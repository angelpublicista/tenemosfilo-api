-- Versiones de cotizacion y propuesta enviada.
--
-- Una oportunidad puede tener varias cotizaciones y todas se conservan. La
-- VIGENTE es la enviada de version mas alta; no hay columna que lo marque a
-- proposito, porque seria un segundo sitio donde decir cual manda y dos sitios
-- acaban diciendo cosas distintas.
--
-- Crear una cotizacion y enviarla son dos cosas distintas: se puede armar una
-- y no mandarla nunca. Por eso `sentAt` va aparte del estado.
--
-- `sentVia` distingue lo mandado desde FILO de lo mandado por WhatsApp o por
-- el correo propio. El estado comercial tiene que poder reflejar el segundo
-- caso aunque FILO no haya enviado nada.
--
-- `proposalSentAt` en la oportunidad marca cuando el cliente recibio lo que
-- necesitaba para decidir: la cotizacion en una privada, el enlace de catalogo
-- en una abierta.
--
-- Las cotizaciones que ya existen quedan en version 1 y sin enviar. No se les
-- supone un envio que nadie registro.

-- CreateEnum
CREATE TYPE "QuoteChannel" AS ENUM ('FILO', 'EXTERNO');

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentVia" "QuoteChannel";

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "proposalSentAt" TIMESTAMP(3);
