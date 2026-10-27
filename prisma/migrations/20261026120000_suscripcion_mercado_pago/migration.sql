-- Suscripcion de anfitriones cobrada por Mercado Pago (cobro automatico).
--
-- Wompi sigue siendo el valor por defecto: al desplegar nada cambia hasta que
-- el administrador configure Mercado Pago y lo elija como pasarela.

ALTER TABLE "Company"
  ADD COLUMN "subscriptionMpPreapprovalId" TEXT,
  ADD COLUMN "subscriptionMpStatus" TEXT;

CREATE UNIQUE INDEX "Company_subscriptionMpPreapprovalId_key" ON "Company"("subscriptionMpPreapprovalId");

ALTER TABLE "PlatformSettings"
  ADD COLUMN "mercadopagoEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mercadopagoEnvironment" "PaymentEnvironment" NOT NULL DEFAULT 'SANDBOX',
  ADD COLUMN "mercadopagoAccessToken" TEXT,
  ADD COLUMN "mercadopagoWebhookSecret" TEXT,
  ADD COLUMN "subscriptionProvider" "PaymentProvider" NOT NULL DEFAULT 'WOMPI';
