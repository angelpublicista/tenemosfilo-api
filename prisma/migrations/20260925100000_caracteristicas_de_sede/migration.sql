-- Caracteristicas de la sede.
--
-- Las facilidades van como lista de claves y no como una columna booleana por
-- cada una: son casillas de una misma pregunta, y añadir una nueva el dia de
-- mañana deberia ser un despliegue, no una migracion. Postgres filtra por
-- contenido de array, asi que buscar sedes con parqueadero sigue siendo
-- barato.
--
-- De los audiovisuales se guarda una frase y no un inventario de equipos. Un
-- inventario —dos micros, tres manteles— es otro producto, y una frase
-- resuelve casi todo sin pedirle a nadie que mantenga un almacen al dia.
--
-- Los baños quedan NULL en las sedes que ya existen: no se supone ninguno.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "avEquipmentDetail" TEXT,
ADD COLUMN     "bathroomsCount" INTEGER;
