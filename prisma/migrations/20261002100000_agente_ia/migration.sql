-- Agente de IA del anfitrion, conectado a su WhatsApp.
--
-- Vive en su propia tabla y no en Company por una razon practica: son quince
-- campos que solo interesan a quien enciende el agente, y meterlos en Company
-- obliga a cargarlos en cada lectura de empresa que hace media aplicacion.
--
-- Las credenciales de WhatsApp se guardan cifradas, igual que las de las
-- pasarelas: con ellas se escribe a los clientes en nombre del anfitrion, y una
-- copia de la base no puede bastar para suplantarlo.
--
-- La conversacion se guarda entera. No es solo memoria para el modelo: el
-- anfitrion tiene que poder leer que le dijo su agente a un cliente, y sin eso
-- encender un agente es firmar en blanco.

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "nombre" TEXT NOT NULL DEFAULT 'Asistente',
    "tono" TEXT,
    "instrucciones" TEXT,
    "puedeCrearSolicitud" BOOLEAN NOT NULL DEFAULT true,
    "puedeEnviarEnlace" BOOLEAN NOT NULL DEFAULT true,
    "waPhoneNumberId" TEXT,
    "waNumero" TEXT,
    "waAccessToken" TEXT,
    "waVerifyToken" TEXT,
    "waAppSecret" TEXT,
    "mensajesPorMes" INTEGER NOT NULL DEFAULT 500,
    "mensajesUsados" INTEGER NOT NULL DEFAULT 0,
    "mesDelConteo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "telefono" TEXT NOT NULL,
    "nombrePerfil" TEXT,
    "contactId" TEXT,
    "opportunityId" TEXT,
    -- Para poder apagarlo en una conversacion concreta sin apagar el agente.
    "pausada" BOOLEAN NOT NULL DEFAULT false,
    "ultimoMensajeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "rol" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    -- Que herramienta uso el agente en ese turno, si uso alguna. Es lo que
    -- permite entender despues por que contesto lo que contesto.
    "herramienta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiAgent_companyId_key" ON "AiAgent"("companyId");

-- CreateIndex
CREATE INDEX "AiAgent_waPhoneNumberId_idx" ON "AiAgent"("waPhoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "AiConversation_companyId_canal_telefono_key" ON "AiConversation"("companyId", "canal", "telefono");

-- CreateIndex
CREATE INDEX "AiConversation_companyId_ultimoMensajeAt_idx" ON "AiConversation"("companyId", "ultimoMensajeAt");

-- CreateIndex
CREATE INDEX "AiMessage_conversationId_createdAt_idx" ON "AiMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiAgent" ADD CONSTRAINT "AiAgent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMessage" ADD CONSTRAINT "AiMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
