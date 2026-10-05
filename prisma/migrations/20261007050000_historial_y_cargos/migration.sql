-- TR-39 y TR-12.
--
-- `changes`: el historial de una reserva. Editarla o reagendarla conserva el
-- mismo id, y eso solo sirve de algo si se puede ver que le fue pasando.
--
-- `extraCharges`: lo que se acordo cobrar de mas despues de vender. Va aparte
-- del precio porque el precio original no se recalcula: lo vendido es lo
-- vendido, y un cambio de fecha o de cantidad no mueve el dinero solo.
ALTER TABLE "Reservation" ADD COLUMN "changes" JSONB[] DEFAULT ARRAY[]::JSONB[];
ALTER TABLE "Reservation" ADD COLUMN "extraCharges" JSONB[] DEFAULT ARRAY[]::JSONB[];
