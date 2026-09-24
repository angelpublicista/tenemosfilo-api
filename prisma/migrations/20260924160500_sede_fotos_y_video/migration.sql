-- Fotos y video de la sede.
--
-- Las fotos van en un array ordenado y la PRIMERA es la principal. No hay una
-- columna aparte para señalar cual lo es: dos sitios donde decirlo acaban
-- diciendo cosas distintas, y entonces hay que elegir a cual creerle. Marcar
-- una como principal es moverla al frente.
--
-- Del video solo se guarda el enlace. Alojar el archivo es caro y no aporta
-- nada que un enlace no resuelva; YouTube y Vimeo ademas se incrustan, y
-- cualquier otro se enlaza.
--
-- Array vacio por defecto y no NULL: "sin fotos" y "una lista de cero fotos"
-- son lo mismo aqui, y tener las dos formas obliga a comprobar las dos.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "videoUrl" TEXT;
