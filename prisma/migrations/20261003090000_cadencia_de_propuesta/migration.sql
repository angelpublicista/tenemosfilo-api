-- La propuesta sin respuesta pasa a tener tres recordatorios en vez de uno:
-- a las 48 h (el que ya existia), al tercer dia y al septimo. Despues se para;
-- a partir de ahi insistir ya no es seguimiento.
--
-- Los valores nuevos del enum se anaden detras de PROPUESTA para que el orden
-- del tipo siga contando la historia en el orden en que ocurre.
ALTER TYPE "FollowupKind" ADD VALUE IF NOT EXISTS 'PROPUESTA_3D' AFTER 'PROPUESTA';
ALTER TYPE "FollowupKind" ADD VALUE IF NOT EXISTS 'PROPUESTA_7D' AFTER 'PROPUESTA_3D';
