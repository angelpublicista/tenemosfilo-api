import { Router } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploadsController } from './uploads.controller.js';
import { presignSchema } from './uploads.schemas.js';

export const uploadsRouter = Router();

// Subidas firmadas solo para humanos por ahora; abrir a API keys requiere
// un scope dedicado y cuotas (pendiente).
uploadsRouter.use(requireAuth, requireHumanAuth);

// Devuelve { uploadUrl, key, publicUrl, maxBytes, contentType }
uploadsRouter.post('/presign', validate(presignSchema), uploadsController.presign);
