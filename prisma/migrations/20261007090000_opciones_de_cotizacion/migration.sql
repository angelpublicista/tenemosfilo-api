-- TR-14. Las opciones que se le ponen al cliente sobre la mesa.
--
-- Hasta tres y simultaneas. No son versiones de la cotizacion —eso ya existe y
-- es el historial de lo que se le fue mandando— sino alternativas vivas a la
-- vez entre las que elige: "el sabado 12 en la terraza, el domingo 13 en el
-- salon, o el sabado 19 mas barato".
--
-- Antes se escribian como texto en las notas, asi que el calendario no sabia
-- de ellas y aceptar una habia que teclearla a mano.
CREATE TABLE "QuoteOption" (
  "id" TEXT NOT NULL,
  "quoteId" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 1,
  "label" TEXT,
  "experienceId" TEXT,
  "eventDate" TIMESTAMP(3),
  "eventTime" TEXT,
  "guests" INTEGER,
  "total" DECIMAL(12,2),
  "notes" TEXT,
  "chosenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "QuoteOption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "QuoteOption_quoteId_position_key" ON "QuoteOption"("quoteId", "position");
CREATE INDEX "QuoteOption_quoteId_idx" ON "QuoteOption"("quoteId");

ALTER TABLE "QuoteOption"
  ADD CONSTRAINT "QuoteOption_quoteId_fkey"
  FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "QuoteOption"
  ADD CONSTRAINT "QuoteOption_experienceId_fkey"
  FOREIGN KEY ("experienceId") REFERENCES "Experience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
