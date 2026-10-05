-- TR-24. Las estrellas que pone el comensal, en cuatro cosas distintas.
--
-- Cuatro y no una porque son cuatro decisiones distintas del anfitrion: un
-- sitio incomodo con comida excelente no se arregla igual que lo contrario.
--
-- `rating` (que ya existia) es otra cosa y se queda: es la nota que le pone el
-- ANFITRION al cerrar la experiencia, para el.
ALTER TABLE "Reservation" ADD COLUMN "ratings" JSONB;
ALTER TABLE "Reservation" ADD COLUMN "ratingToken" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "ratingRequestedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Reservation_ratingToken_key" ON "Reservation"("ratingToken");
