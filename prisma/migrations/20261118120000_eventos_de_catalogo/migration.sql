-- Interaccion en el catalogo publico de un revendedor.

CREATE TYPE "TipoEventoCatalogo" AS ENUM ('VISITA', 'VER_EXPERIENCIA', 'ELEGIR_FECHA', 'INICIAR_RESERVA');

CREATE TABLE "EventoDeCatalogo" (
    "id" TEXT NOT NULL,
    "resellerCompanyId" TEXT NOT NULL,
    "tipo" "TipoEventoCatalogo" NOT NULL,
    "sessionId" TEXT NOT NULL,
    "experienceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventoDeCatalogo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventoDeCatalogo_resellerCompanyId_createdAt_idx" ON "EventoDeCatalogo"("resellerCompanyId", "createdAt");

ALTER TABLE "EventoDeCatalogo" ADD CONSTRAINT "EventoDeCatalogo_resellerCompanyId_fkey" FOREIGN KEY ("resellerCompanyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
