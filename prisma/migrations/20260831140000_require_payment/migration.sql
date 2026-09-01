-- Exigir pago para reservar.
--
-- En la empresa es nullable a proposito: null significa "lo que diga la
-- plataforma", que es distinto de un false explicito. Sin esa diferencia, un
-- cambio del valor por defecto no alcanzaria a las empresas ya creadas.
ALTER TABLE "Company" ADD COLUMN "requirePayment" BOOLEAN;
ALTER TABLE "PlatformSettings" ADD COLUMN "requirePaymentDefault" BOOLEAN NOT NULL DEFAULT false;
