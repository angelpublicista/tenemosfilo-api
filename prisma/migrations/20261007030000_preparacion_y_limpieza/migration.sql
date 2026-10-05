-- TR-19. Lo que ocupa una experiencia ademas de si misma.
--
-- Una cena de tres horas no deja el sitio libre a las tres: hay que montar
-- antes y recoger despues. La ocupacion real es preparacion + duracion +
-- limpieza, y es lo que se cruza con la agenda del anfitrion.
--
-- Nulos a proposito: lo que ya existe no gana tiempos de montaje por decreto.
ALTER TABLE "Experience" ADD COLUMN "prepTime" INTEGER;
ALTER TABLE "Experience" ADD COLUMN "cleanupTime" INTEGER;
