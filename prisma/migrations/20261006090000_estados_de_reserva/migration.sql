-- Los cinco estados de una reserva (TR-01 y TR-08 del documento transversal).
--
-- PRE_RESERVED era la "pre-reserva" de una privada, pero no se distinguia en
-- nada de una pendiente: las dos bloquean el recurso y las dos esperan una
-- decision. Pasa a PENDING.
--
-- IN_PROGRESS era "esta ocurriendo ahora". No cambiaba nada operativo y nadie
-- lo ponia a mano; esas reservas siguen confirmadas hasta que se registre la
-- asistencia.
--
-- RESCHEDULED no era un estado sino un hecho: una reserva movida sigue viva y
-- sigue confirmada. El dato de la mudanza ya vive en `rescheduling`, asi que
-- no se pierde nada al pasarlas a CONFIRMED.
UPDATE "Reservation" SET "status" = 'PENDING' WHERE "status" = 'PRE_RESERVED';
UPDATE "Reservation" SET "status" = 'CONFIRMED' WHERE "status" IN ('IN_PROGRESS', 'RESCHEDULED');

-- Postgres no deja quitar valores de un enum: hay que construir el tipo nuevo
-- y mudar la columna.
ALTER TYPE "ReservationStatus" RENAME TO "ReservationStatus_viejo";

CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

ALTER TABLE "Reservation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Reservation"
  ALTER COLUMN "status" TYPE "ReservationStatus"
  USING ("status"::text::"ReservationStatus");
ALTER TABLE "Reservation" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "ReservationStatus_viejo";
