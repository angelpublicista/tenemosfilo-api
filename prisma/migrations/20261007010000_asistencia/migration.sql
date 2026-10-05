-- TR-09 y TR-25. Cuanta gente aparecio de verdad, que es distinto de cuanta
-- se vendio: de diez reservados pueden venir ocho. Null mientras la
-- experiencia no se haya cerrado; no se presume que vinieron todos.
ALTER TABLE "Reservation" ADD COLUMN "attendedCount" INTEGER;
