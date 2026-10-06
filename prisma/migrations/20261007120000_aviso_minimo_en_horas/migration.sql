-- El aviso minimo estaba guardado en dos unidades distintas.
--
-- El modelo decia "minutos" en un comentario, la interfaz decia "horas" con
-- 24 por defecto, y nadie leia el campo: asi que las semillas escribieron
-- minutos (120 = dos horas, 1440 = un dia) y los horarios creados desde la
-- pantalla escribieron horas (24 = un dia). Mientras no se usaba, daba igual.
--
-- Al empezar a cortar ventas de verdad (TR-06) dejo de dar igual: un 120
-- leido como horas son cinco dias de anticipacion, y esas experiencias
-- estaban rechazando reservas que deberian aceptar.
--
-- Se normaliza a horas. El corte es 100: nadie pide mas de cuatro dias de
-- aviso escribiendo "100", y en minutos 100 son menos de dos horas, asi que
-- por encima de ahi solo pueden ser minutos de las semillas.
UPDATE "Experience"
SET "minimumNotice" = GREATEST(1, ROUND("minimumNotice" / 60.0))
WHERE "minimumNotice" >= 100;

UPDATE "Availability"
SET "minimumNotice" = GREATEST(1, ROUND("minimumNotice" / 60.0))
WHERE "minimumNotice" >= 100;
