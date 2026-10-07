-- En que idiomas se da la experiencia, y en cual pidio quien reserva.
--
-- Es de la experiencia y no del anfitrion: el mismo cocinero puede dar su
-- taller en español y en ingles, y la cata solo en español porque el
-- vocabulario tecnico no lo tiene en otro idioma.
--
-- Codigos ISO 639-1 y no texto libre: "Ingles", "ingles" e "ING" son el mismo
-- idioma escrito de tres formas.
--
-- Solo se añade. Vacio significa "no se declaro", que es como venia
-- funcionando: no se le pregunta nada al comensal.

ALTER TABLE "Experience" ADD COLUMN "languages" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Reservation" ADD COLUMN "language" TEXT;
