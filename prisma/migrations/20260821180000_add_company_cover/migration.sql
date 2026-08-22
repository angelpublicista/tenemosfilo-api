-- Portada del catalogo publico: imagen, video o varias imagenes.
--
-- Arranca en NONE para que ningun catalogo publicado cambie de aspecto sin
-- que su anfitrion lo decida.
CREATE TYPE "CoverType" AS ENUM ('NONE', 'IMAGE', 'VIDEO', 'SLIDER');

ALTER TABLE "Company" ADD COLUMN "coverType" "CoverType" NOT NULL DEFAULT 'NONE';
ALTER TABLE "Company" ADD COLUMN "coverImages" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Company" ADD COLUMN "coverVideo" TEXT;
