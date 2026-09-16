-- Departamento del lugar puntual de una experiencia.
--
-- Hasta ahora solo se guardaba la ciudad, escrita a mano. La ciudad sola no
-- basta: hay municipios con el mismo nombre en varios departamentos, y el
-- selector del panel encadena uno con otro, asi que sin departamento no habia
-- forma de ofrecer la lista correcta.

-- AlterTable
ALTER TABLE "Experience" ADD COLUMN     "presentialState" TEXT;
