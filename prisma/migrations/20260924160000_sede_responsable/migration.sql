-- Persona responsable de cada sede.
--
-- Apunta a un contacto de la empresa en vez de repetir sus datos: nombre,
-- cargo y telefono ya estan guardados una vez, y copiarlos aqui los
-- condenaria a quedarse viejos en cuanto alguien cambie de numero.
--
-- ON DELETE SET NULL: si el contacto desaparece, la sede sigue existiendo y
-- funcionando, solo se queda sin responsable. Tumbar una sede porque alguien
-- salio del equipo seria absurdo.
--
-- Nullable: las sedes que ya existen no tienen ninguno asignado. El
-- formulario lo exige de aqui en adelante, pero nada se rompe mientras tanto.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "responsibleContactId" TEXT;

-- CreateIndex
CREATE INDEX "Location_responsibleContactId_idx" ON "Location"("responsibleContactId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_responsibleContactId_fkey" FOREIGN KEY ("responsibleContactId") REFERENCES "CompanyContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
