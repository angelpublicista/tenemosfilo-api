-- Ajustes de la empresa que hoy vivian solo en la UI y no se guardaban.
--
-- blockWhenFull arranca en true: es lo que la plataforma ya hacia de hecho
-- (nadie queria vender por encima del aforo) y desactivarlo debe ser una
-- decision explicita del anfitrion.
ALTER TABLE "Company" ADD COLUMN "tagline" TEXT;
ALTER TABLE "Company" ADD COLUMN "autoConfirmReservations" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "blockWhenFull" BOOLEAN NOT NULL DEFAULT true;
