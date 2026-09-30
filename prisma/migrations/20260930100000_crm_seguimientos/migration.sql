-- Seguimientos comerciales automaticos y "no contactar".
--
-- Los seguimientos se crean solos: al entrar la solicitud (24, 48 y 72 horas)
-- y al enviarse la propuesta. Pedirle al comercial que los cree a mano es la
-- forma segura de que no existan.
--
-- `dueAt` se guarda calculado en vez de deducirse al leer, para que la lista de
-- pendientes sea una consulta simple y no una cuenta por fila.
--
-- NO_APLICA se distingue de HECHO a proposito: uno mide gestion y el otro solo
-- limpia la lista. Un seguimiento deja de aplicar cuando la oportunidad
-- avanza, se cierra, o el contacto pide no ser molestado.
--
-- `doNotContact` va aparte de `status` del contacto porque es una peticion
-- suya, no un estado del negocio: un contacto puede estar activo y aun asi
-- haber pedido que no le escriban.

-- CreateEnum
CREATE TYPE "FollowupKind" AS ENUM ('LEAD_24H', 'LEAD_48H', 'LEAD_72H', 'PROPUESTA');
CREATE TYPE "FollowupStatus" AS ENUM ('PENDIENTE', 'HECHO', 'NO_APLICA');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "doNotContact" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Followup" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "kind" "FollowupKind" NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowupStatus" NOT NULL DEFAULT 'PENDIENTE',
    "doneAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Followup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Followup_opportunityId_idx" ON "Followup"("opportunityId");
CREATE INDEX "Followup_status_dueAt_idx" ON "Followup"("status", "dueAt");
CREATE UNIQUE INDEX "Followup_opportunityId_kind_key" ON "Followup"("opportunityId", "kind");

-- AddForeignKey
ALTER TABLE "Followup" ADD CONSTRAINT "Followup_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
