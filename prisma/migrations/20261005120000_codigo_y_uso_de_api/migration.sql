-- Dos cosas para que una venta de canal no pueda quedarse fuera de FILO.
--
-- 1) El codigo de confirmacion que el cliente enseña al llegar. Una venta que
--    no entro por aqui no tiene codigo valido, asi que el anfitrion se entera
--    en la puerta. Va aparte del numero de reserva porque ese lleva la hora
--    dentro y solo tres caracteres al azar: se puede adivinar.
-- 2) El uso de cada API key por dia, para poder ver quien lee mucho catalogo
--    y vende poco por aqui.
ALTER TABLE "Reservation" ADD COLUMN "confirmationCode" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "checkedInAt" TIMESTAMP(3);
ALTER TABLE "Reservation" ADD COLUMN "checkedInById" TEXT;

CREATE UNIQUE INDEX "Reservation_confirmationCode_key" ON "Reservation"("confirmationCode");
CREATE INDEX "Reservation_checkedInAt_idx" ON "Reservation"("checkedInAt");

ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_checkedInById_fkey"
  FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ApiKeyUsage" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "dia" DATE NOT NULL,
    "lecturas" INTEGER NOT NULL DEFAULT 0,
    "escrituras" INTEGER NOT NULL DEFAULT 0,
    "reservas" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiKeyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKeyUsage_apiKeyId_dia_key" ON "ApiKeyUsage"("apiKeyId", "dia");
CREATE INDEX "ApiKeyUsage_dia_idx" ON "ApiKeyUsage"("dia");

ALTER TABLE "ApiKeyUsage" ADD CONSTRAINT "ApiKeyUsage_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
