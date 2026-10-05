-- TR-26. La venta de un revendedor le deja al anfitrion el cliente.
--
-- Antes el comprador vivia solo dentro del JSON `client` de la reserva y no
-- llegaba al CRM: el anfitrion vendia y no se quedaba con nadie a quien
-- volver a venderle.
ALTER TABLE "Reservation" ADD COLUMN "contactId" TEXT;

CREATE INDEX "Reservation_contactId_idx" ON "Reservation"("contactId");

ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
