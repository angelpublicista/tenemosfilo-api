-- TR-43. La clave que manda quien vende para que un reintento no venda dos
-- veces. Unica en toda la tabla: dos canales distintos que mandaran la misma
-- clave se pisarian, y eso es mejor que crear dos reservas por un timeout.
ALTER TABLE "Reservation" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Reservation_idempotencyKey_key" ON "Reservation"("idempotencyKey");
