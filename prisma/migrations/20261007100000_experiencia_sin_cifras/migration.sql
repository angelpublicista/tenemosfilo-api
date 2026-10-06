-- Una experiencia deja de llevar cifras de reservas e ingresos.
--
-- Las reservas son de Reservas y el dinero es de Ingresos, que ademas lo
-- desglosa por experiencia. Tener los mismos numeros aqui significaba
-- mantener dos cifras de lo mismo, y dos cifras de lo mismo acaban
-- discrepando.
--
-- No se pierde nada: nadie escribia estas dos columnas, estaban en cero en
-- todas las filas, y la pantalla prometia "0 reservas" y "$0" a quien si
-- habia vendido. Lo que de verdad se ha vendido sale de las reservas.
ALTER TABLE "Experience" DROP COLUMN "totalBookings";
ALTER TABLE "Experience" DROP COLUMN "totalRevenue";
