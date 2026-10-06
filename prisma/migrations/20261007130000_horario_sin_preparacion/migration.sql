-- Fuera del horario la preparacion y la anticipacion minima.
--
-- Segundo paso: ya nadie las lee —eso salio en el despliegue anterior— asi que
-- ahora se borran. Viven en la experiencia, que es de donde dependen: un mismo
-- calendario sirve a una cata que se monta en diez minutos y se reserva el
-- mismo dia, y a un taller que necesita una hora de montaje y dos dias de
-- aviso. Guardarlas en el horario obligaba a elegir una de las dos.
ALTER TABLE "Availability" DROP COLUMN "bufferTime";
ALTER TABLE "Availability" DROP COLUMN "minimumNotice";
