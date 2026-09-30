-- Enlace de reserva y datos de facturacion.
--
-- `bookingToken` es lo que permite mandarle a un cliente su enlace sin meter
-- su nombre, su correo ni su telefono en la URL. El motor publico canjea el
-- token por esos datos; la URL solo lleva una cadena opaca. Es unico porque
-- es la clave de busqueda, y se guarda cuando se genero para poder decir en
-- pantalla desde cuando esta fuera.
--
-- `billingData` es la foto de los datos de facturacion en el momento de la
-- venta. No basta con mirar la empresa del CRM: esos datos cambian, y una
-- factura se emite contra lo que era cierto el dia que se vendio.

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "bookingToken" TEXT,
ADD COLUMN     "bookingTokenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "billingData" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_bookingToken_key" ON "Opportunity"("bookingToken");
