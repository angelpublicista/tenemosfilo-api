-- Digito de verificacion del NIT de la empresa.
--
-- Es deducible del propio numero (Orden Administrativa 4 de 1989 de la DIAN),
-- asi que guardarlo es redundante a proposito: es lo que aparece impreso en el
-- RUT y en las facturas —"900.123.456-7"— y tenerlo evita recalcularlo en cada
-- sitio que lo muestre.
--
-- Que sea deducible tambien lo hace util como comprobacion: si el DV que trae
-- un RUT no cuadra con el calculado, el NIT se leyo o se tecleo mal.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "documentDv" TEXT;
