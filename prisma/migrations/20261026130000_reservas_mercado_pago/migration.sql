-- Pasarela con la que FILO cobra las reservas: Wompi (por defecto) o Mercado Pago.
-- Al desplegar nada cambia hasta que el administrador la cambie en Ajustes.

ALTER TABLE "PlatformSettings"
  ADD COLUMN "reservationsProvider" "PaymentProvider" NOT NULL DEFAULT 'WOMPI';
