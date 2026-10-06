-- Fuera el aforo de la experiencia y de la publicacion.
--
-- Los cupos son de la franja del horario: el almuerzo y la cena de un sabado
-- son dos inventarios distintos. Un numero unico en la pieza no podia decir
-- eso, y mientras existio convivian dos formas de contar.
--
-- SEGUNDO PASO de dos. El codigo dejo de leer y escribir estas columnas en
-- 76ee5d4, y 71ecb1e ya volco su valor a las franjas, asi que lo que decian ya
-- vive donde tiene que vivir.
--
-- `minCapacity` NO se va: no es inventario, es el tamaño de grupo por debajo
-- del cual la experiencia no se hace.

ALTER TABLE "Experience" DROP COLUMN "capacity";
ALTER TABLE "LocationListing" DROP COLUMN "capacity";
