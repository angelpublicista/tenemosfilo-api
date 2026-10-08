-- Bold como tercera pasarela propia del anfitrion.
--
-- Solo se añade un valor al enum. Las columnas son las mismas que ya usan
-- Wompi y Mercado Pago: en Bold la llave de identidad va en la publica y la
-- llave secreta —con la que firma sus notificaciones— en la privada.

ALTER TYPE "PaymentProvider" ADD VALUE 'BOLD';
