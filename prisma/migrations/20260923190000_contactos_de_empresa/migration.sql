-- Contactos de la empresa: a quien escribir para cada asunto.
--
-- No confundir con la tabla Contact, que son los CLIENTES del anfitrion en su
-- CRM. Estos son suyos: su gente. Por eso tabla aparte y no un tipo mas alla.
--
-- RESERVAS y CONTABILIDAD son obligatorios en el formulario y solo cabe uno
-- de cada; OTRO admite hasta tres. Esas reglas viven en el servicio y no en un
-- indice unico porque solo aplican a dos de los tres valores del enum, y un
-- unique sobre (companyId, type) impediria tener mas de un OTRO.
--
-- El borrado es en cascada: un contacto no significa nada sin su empresa.

-- CreateEnum
CREATE TYPE "CompanyContactType" AS ENUM ('RESERVAS', 'CONTABILIDAD', 'OTRO');

-- CreateTable
CREATE TABLE "CompanyContact" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CompanyContactType" NOT NULL,
    "label" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "position" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyContact_companyId_type_idx" ON "CompanyContact"("companyId", "type");

-- AddForeignKey
ALTER TABLE "CompanyContact" ADD CONSTRAINT "CompanyContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
