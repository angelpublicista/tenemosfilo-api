-- La carta de un anfitrion, como entidad propia.
--
-- Hasta ahora lo que se come vivia dentro del texto de cada experiencia, asi
-- que la misma carta habia que repetirla y mantenerla en cada una. Sacandola
-- aqui se edita en un solo sitio y se vincula a las experiencias que la usen.
--
-- Las secciones y sus platos van en la columna JSON `sections`: un menu se
-- edita entero de una vez, asi que el orden sale del array y guardar es un
-- solo UPDATE. A cambio no se puede consultar por plato; si algun dia hace
-- falta (buscar un ingrediente, filtrar por alergeno), habra que sacarlos a
-- sus propias tablas.
--
-- `_ExperienceMenus` es la tabla puente que genera Prisma para la relacion
-- N:M: una carta sirve a varias experiencias y una experiencia puede ofrecer
-- varias (la normal y la vegetariana).

-- CreateTable
CREATE TABLE "Menu" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "sections" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ExperienceMenus" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "Menu_companyId_idx" ON "Menu"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "_ExperienceMenus_AB_unique" ON "_ExperienceMenus"("A", "B");

-- CreateIndex
CREATE INDEX "_ExperienceMenus_B_index" ON "_ExperienceMenus"("B");

-- AddForeignKey
ALTER TABLE "Menu" ADD CONSTRAINT "Menu_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExperienceMenus" ADD CONSTRAINT "_ExperienceMenus_A_fkey" FOREIGN KEY ("A") REFERENCES "Experience"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExperienceMenus" ADD CONSTRAINT "_ExperienceMenus_B_fkey" FOREIGN KEY ("B") REFERENCES "Menu"("id") ON DELETE CASCADE ON UPDATE CASCADE;
