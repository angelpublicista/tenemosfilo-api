-- Comision de FILO cuando el anfitrion cobra con su propia pasarela.
--
-- Hasta ahora era siempre cero. Se deja en cero por defecto: nada cambia hasta
-- que el administrador la fije.

ALTER TABLE "PlatformSettings"
  ADD COLUMN "filoCommissionOwnGatewayType" "CommissionType" NOT NULL DEFAULT 'PERCENT',
  ADD COLUMN "filoCommissionOwnGatewayValue" DECIMAL(12,2) NOT NULL DEFAULT 0;
