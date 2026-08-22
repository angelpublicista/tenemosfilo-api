-- Historial de slugs de cada empresa.
--
-- Renombrar la empresa regeneraba el slug y dejaba muertos los enlaces de
-- catalogo ya compartidos. Ahora el slug anterior se conserva y sigue
-- resolviendo al mismo catalogo.
ALTER TABLE "Company" ADD COLUMN "previousSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[];
