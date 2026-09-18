-- Colores de marca del anfitrion.
--
-- El catalogo publico y los correos de reserva salian siempre con el naranja
-- de la plataforma, aunque quien presta el servicio —y a quien el comensal
-- reconoce— es el anfitrion.
--
-- Se guardan solo los dos colores que el anfitrion elige, en hexadecimal.
-- Los tonos derivados (el de paso del raton, y si el texto encima va en
-- blanco o en negro para que se lea) se calculan al pintar: guardarlos seria
-- abrir la puerta a que queden desparejados de su origen.
--
-- null = usa los de la plataforma, que es lo que tienen todas las empresas
-- existentes al aplicar esto.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "brandPrimary" TEXT,
ADD COLUMN     "brandSecondary" TEXT;
