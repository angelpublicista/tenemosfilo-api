-- Ubicacion de la sede en el mapa.
--
-- Se calcula a partir de la direccion escrita, pero el anfitrion puede
-- corregirla arrastrando el pin: en Colombia la nomenclatura "Cra 13 #85-32"
-- se geocodifica a la cuadra mas veces de las que uno querria. Por eso lo
-- guardado manda sobre cualquier recalculo posterior.
--
-- Dos columnas y no un Json: asi se pueden consultar por rango el dia que haya
-- que buscar sedes cerca de un punto.
--
-- Nullable las dos: las sedes que ya existen no tienen coordenadas, y no se
-- inventan. Van juntas o no van —una latitud sin longitud no ubica nada—, y
-- eso lo comprueba el API, que es donde puede mirarse el par completo.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;
