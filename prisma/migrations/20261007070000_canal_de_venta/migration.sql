-- TR-04. El canal de venta como valor tipado y guardado.
--
-- Antes la comisionabilidad se deducia de `source` mas "tiene revendedor", es
-- decir de dos campos que hablan de otra cosa: el dia que cambiara como se
-- crea una reserva, cambiaria sin querer a quien se le cobra.
CREATE TYPE "SalesChannel" AS ENUM ('MANUAL', 'CHECKOUT', 'RESELLER', 'CRM');

ALTER TABLE "Reservation" ADD COLUMN "channel" "SalesChannel" NOT NULL DEFAULT 'MANUAL';

-- Lo que ya existe se clasifica con la misma regla con la que se venia
-- deduciendo, en este orden: primero revendedor, que manda sobre todo lo
-- demas; luego las que venian de una oportunidad del CRM; luego el checkout.
UPDATE "Reservation" SET "channel" = 'RESELLER' WHERE "resellerCompanyId" IS NOT NULL;

UPDATE "Reservation" SET "channel" = 'CRM'
WHERE "resellerCompanyId" IS NULL
  AND "opportunityId" IS NOT NULL
  AND "source" = 'BOOKING_ENGINE';

UPDATE "Reservation" SET "channel" = 'CHECKOUT'
WHERE "resellerCompanyId" IS NULL
  AND "opportunityId" IS NULL
  AND "source" = 'BOOKING_ENGINE';
