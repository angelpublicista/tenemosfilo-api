-- Representante legal de la empresa: quien firma por ella.
--
-- El certificado de Camara de Comercio ya traia este dato y la lectura
-- automatica ya lo extraia, pero no habia donde guardarlo: se leia y se
-- tiraba.
--
-- Solo tiene sentido en una persona juridica. Una persona natural se
-- representa a si misma, asi que el formulario no se lo pide.
--
-- El tipo de documento reutiliza el enum DocumentType en vez de crear uno
-- casi igual que acabaria desincronizado. Del enum no aplica NIT: esto
-- identifica a una PERSONA, y el formulario no lo ofrece.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "legalRepName" TEXT,
ADD COLUMN     "legalRepDocType" "DocumentType",
ADD COLUMN     "legalRepDocNumber" TEXT;
