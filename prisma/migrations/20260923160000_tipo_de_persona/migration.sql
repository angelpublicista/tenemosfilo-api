-- Tipo de persona y segundo tipo de empresa.
--
-- El tipo de persona no es descriptivo: decide que documentacion legal se le
-- pide al anfitrion. Una persona natural no esta inscrita en Camara de
-- Comercio, asi que pedirle ese certificado es pedirle algo que no existe.
--
-- Queda NULL en las empresas que ya existen. Mientras nadie lo elija se les
-- siguen pidiendo los dos documentos, que es exactamente lo que veian antes
-- de este cambio: nadie se encuentra la pantalla distinta sin haber tocado
-- nada.
--
-- El segundo tipo de empresa es opcional porque un negocio rara vez es una
-- sola cosa —un hotel que ademas hace catering, una finca que ademas da
-- clases—. Reutiliza el enum del principal: son la misma clasificacion.

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('NATURAL', 'JURIDICA');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "personType" "PersonType",
ADD COLUMN     "companyTypeSecondary" "CompanyType";
