-- Salones dentro de una sede.
--
-- `hasRooms` guarda la RESPUESTA a "¿la sede tiene espacios diferenciados?" y
-- no se deduce de si hay salones creados: "no tengo salones" es una respuesta
-- dada y "todavia no he creado ninguno" es otra cosa. Sin el campo no habria
-- forma de distinguirlas y el formulario volveria a preguntar cada vez.
--
-- Queda NULL en las sedes que ya existen: nadie ha contestado todavia.
--
-- El salon guarda lo justo: nombre, descripcion, capacidad y fotos. NO hay
-- capacidades por montaje —auditorio, coctel, escuela, imperial— ni planos.
-- Eso es otro producto; meterlo aqui sin necesitarlo llenaria el formulario de
-- campos que nadie rellena.
--
-- Borrado en cascada: un salon no significa nada sin su sede.

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "hasRooms" BOOLEAN;

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxCapacity" INTEGER NOT NULL,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Room_locationId_idx" ON "Room"("locationId");

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
