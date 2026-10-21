-- Suscripcion de los anfitriones a la plataforma: un plan, pago mensual sin
-- permanencia.
--
-- Queda apagada por defecto (subscriptionRequired = false): al desplegar nadie
-- se bloquea. El administrador la enciende cuando la pasarela este lista.

CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

ALTER TABLE "Company"
  ADD COLUMN "subscriptionEndsAt" TIMESTAMP(3),
  ADD COLUMN "subscriptionExempt" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlatformSettings"
  ADD COLUMN "subscriptionRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "subscriptionPrice" DECIMAL(12,2) NOT NULL DEFAULT 79000,
  ADD COLUMN "subscriptionVat" DECIMAL(5,2) NOT NULL DEFAULT 19;

CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "baseAmount" DECIMAL(12,2) NOT NULL,
    "vatAmount" DECIMAL(12,2) NOT NULL,
    "status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL DEFAULT 'WOMPI',
    "transactionId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPayment_reference_key" ON "SubscriptionPayment"("reference");

CREATE INDEX "SubscriptionPayment_companyId_createdAt_idx" ON "SubscriptionPayment"("companyId", "createdAt");

ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
