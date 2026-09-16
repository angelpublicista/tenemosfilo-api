-- RUT y certificado de Camara de Comercio de cada empresa.
--
-- Hasta ahora el registro se rellenaba entero a mano aunque esos datos —NIT,
-- razon social, direccion— ya estuvieran en el RUT que la DIAN entrega en PDF.
--
-- Se guarda la CLAVE de S3 y no una URL, a diferencia de `logo`: estos
-- ficheros viven en el prefijo privado del bucket, fuera de la politica de
-- lectura publica, asi que no hay URL estable que guardar. El enlace se firma
-- en cada lectura y caduca. Un RUT lleva NIT, direccion y a veces datos del
-- representante legal; no es algo que deba quedar abierto a quien acierte la
-- ruta.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "camaraKey" TEXT,
ADD COLUMN     "camaraSubidaEl" TIMESTAMP(3),
ADD COLUMN     "rutKey" TEXT,
ADD COLUMN     "rutSubidoEl" TIMESTAMP(3);
