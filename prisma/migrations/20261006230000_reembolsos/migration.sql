-- TR-30. Los reembolsos de una reserva, totales o parciales, en un solo
-- sitio. Antes vivian repartidos entre `cancellation` y cada baja parcial, y
-- no habia forma de preguntar cuanto se le ha devuelto a una reserva.
ALTER TABLE "Reservation" ADD COLUMN "refunds" JSONB[] DEFAULT ARRAY[]::JSONB[];
