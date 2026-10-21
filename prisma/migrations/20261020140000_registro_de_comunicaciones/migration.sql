-- Registro de los correos transaccionales enviados.
--
-- La clave unica ("reservation:<id>:confirmed") impide que un reintento de
-- webhook o un estado guardado dos veces mande el mismo correo otra vez.

CREATE TABLE "CommunicationLog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "reservationId" TEXT,
    "recipients" TEXT[],
    "sentAt" TIMESTAMP(3),
    "skippedReason" TEXT,
    "actorType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunicationLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunicationLog_key_key" ON "CommunicationLog"("key");

CREATE INDEX "CommunicationLog_reservationId_idx" ON "CommunicationLog"("reservationId");
