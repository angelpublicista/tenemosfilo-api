-- Actividad economica del anfitrion (codigo CIIU).
--
-- Cuatro digitos de la CIIU Rev. 4 adaptada para Colombia. Es un dato que la
-- empresa ya tiene impreso en su RUT, casilla 46, asi que de ahi se lee y se
-- prerrellena en vez de pedirselo a mano.
--
-- Se guarda el codigo a secas y no su descripcion. La descripcion es
-- consecuencia del codigo: tenerla aparte solo abre la puerta a que las dos
-- digan cosas distintas.
--
-- Sin restriccion de dominio en la base. La clasificacion la fija la DIAN y
-- cambia sin avisar; una lista cerrada aqui obligaria a una migracion cada
-- vez que saliera un codigo nuevo, y mientras tanto rechazaria el que el
-- anfitrion tiene en su documento oficial.

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "ciiuCode" TEXT;
