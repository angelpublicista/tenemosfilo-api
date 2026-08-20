import { Router } from 'express';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { auditController } from './audit.controller.js';
import { listAuditQuerySchema } from './audit.schemas.js';

export const auditRouter = Router();

// El historial es de solo lectura y solo para ADMIN: nadie, ni el propio
// admin, puede editarlo o borrarlo desde el API.
auditRouter.use(requireAuth, requireHumanAuth, requireRole('ADMIN'));

auditRouter.get('/', validate(listAuditQuerySchema, 'query'), auditController.list);
