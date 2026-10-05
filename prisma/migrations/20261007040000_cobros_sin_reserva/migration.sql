-- TR-44. Un cobro que llego sin una reserva a la que colgarse.
--
-- Pasa poco, pero pasa: la reserva se borro entre el pago y la notificacion,
-- o la pasarela manda una referencia que no reconocemos. Antes eso era una
-- linea en el log que nadie iba a leer, y el dinero quedaba cobrado sin que
-- existiera nada que lo explicara.
CREATE TABLE "OrphanPayment" (
  "id" TEXT NOT NULL,
  "gateway" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "transactionId" TEXT,
  "amount" DECIMAL(14,2),
  "currency" TEXT,
  "gatewayStatus" TEXT,
  "companyId" TEXT,
  "event" JSONB NOT NULL,
  "resolved" BOOLEAN NOT NULL DEFAULT false,
  "resolvedAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrphanPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrphanPayment_resolved_idx" ON "OrphanPayment"("resolved");
CREATE INDEX "OrphanPayment_reference_idx" ON "OrphanPayment"("reference");
CREATE INDEX "OrphanPayment_createdAt_idx" ON "OrphanPayment"("createdAt");
