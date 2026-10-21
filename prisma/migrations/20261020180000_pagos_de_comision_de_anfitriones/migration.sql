-- Pagos de los anfitriones a FILO por su comision mensual.
--
-- Cuando el anfitrion cobra con su propia pasarela, la comision de FILO no se
-- puede descontar del pago. Se junta por mes, FILO factura por fuera, y aqui
-- queda constancia de lo que ya pago. Lo devengado sale de las reservas.

CREATE TABLE "FeePayment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByEmail" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeePayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeePayment_companyId_period_idx" ON "FeePayment"("companyId", "period");

ALTER TABLE "FeePayment" ADD CONSTRAINT "FeePayment_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
