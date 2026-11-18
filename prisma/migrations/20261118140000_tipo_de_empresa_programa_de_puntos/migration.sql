-- Programa de puntos como tipo de empresa.
--
-- Un programa de lealtad (de un banco, una aerolinea, una tarjeta) canjea
-- puntos por experiencias: vende las de otros, igual que un revendedor, y no
-- es ni agencia ni anfitrion. Se ofrece solo a los revendedores.

ALTER TYPE "CompanyType" ADD VALUE IF NOT EXISTS 'LOYALTY_PROGRAM' BEFORE 'OTHER';
