-- Tipos de empresa que puede ser un anfitrion.
--
-- Habia cuatro (restaurante, catering, food truck y otro) y se quedaban
-- cortos: un hotel, una finca productora o un chef independiente no tenian
-- donde encajar y acababan todos en "otro", que no distingue nada.
--
-- FOODTRUCK desaparece. Se comprobo en produccion antes de tocarlo: ninguna
-- empresa lo tenia —solo hay dos con OTHER y dos sin tipo—, asi que el
-- cambio no deja ningun dato huerfano. Si lo hubiera tenido alguna, este
-- migration habria fallado en el USING de abajo en vez de perder el valor en
-- silencio, que es justo lo que se quiere.
--
-- El tipo se recrea entero, en lugar de ir añadiendo valores con ALTER TYPE
-- ADD VALUE, porque hay que QUITAR uno y eso no se puede de otra forma.

-- AlterEnum
ALTER TYPE "CompanyType" RENAME TO "CompanyType_old";

CREATE TYPE "CompanyType" AS ENUM (
  'RESTAURANT',
  'CAFE',
  'BAR',
  'CULINARY_STUDIO',
  'CATERING',
  'HOTEL',
  'EVENT_VENUE',
  'PRODUCER',
  'BEVERAGE_MAKER',
  'CULINARY_SCHOOL',
  'INDEPENDENT_CHEF',
  'TOUR_OPERATOR',
  'OTHER'
);

ALTER TABLE "Company"
  ALTER COLUMN "companyType" TYPE "CompanyType"
  USING ("companyType"::text::"CompanyType");

DROP TYPE "CompanyType_old";
