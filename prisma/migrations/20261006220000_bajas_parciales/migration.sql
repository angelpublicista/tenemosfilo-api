-- TR-07. Las bajas parciales de una reserva: dos de las diez personas se
-- caen y los otros ocho siguen viniendo. Lista y no campo porque pueden
-- caerse en tandas, y cada tanda lleva su propio reembolso.
ALTER TABLE "Reservation" ADD COLUMN "partialCancellations" JSONB[] DEFAULT ARRAY[]::JSONB[];
