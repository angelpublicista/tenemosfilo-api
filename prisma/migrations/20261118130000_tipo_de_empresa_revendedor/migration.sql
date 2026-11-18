-- Un tipo de empresa para los revendedores.
--
-- La lista era toda de anfitriones (restaurante, hotel, finca...) y una agencia
-- o una plataforma de beneficios solo podia elegir "operador de tours" u
-- "otro". Se añade RESELLER, justo antes de OTHER para conservar el orden en
-- que se le enseña al elegir.
--
-- Solo se AÑADE un valor, asi que basta ALTER TYPE ... ADD VALUE: no hay que
-- recrear el tipo ni tocar ninguna fila.

ALTER TYPE "CompanyType" ADD VALUE IF NOT EXISTS 'RESELLER' BEFORE 'OTHER';
