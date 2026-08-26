-- La empresa que representa a la plataforma.
--
-- Filo tambien vende por su propio canal, asi que necesita una empresa de la
-- que cuelguen sus claves API y sus liquidaciones. Los usuarios ADMIN siguen
-- sin companyId a proposito: media aplicacion filtra por la empresa del
-- usuario cuando la tiene, y darles una les estrecharia la vista global.
ALTER TABLE "PlatformSettings" ADD COLUMN "platformCompanyId" TEXT;

ALTER TABLE "PlatformSettings"
  ADD CONSTRAINT "PlatformSettings_platformCompanyId_fkey"
  FOREIGN KEY ("platformCompanyId") REFERENCES "Company"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
