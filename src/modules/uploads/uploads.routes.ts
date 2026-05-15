import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploadsController } from './uploads.controller.js';
import { presignSchema } from './uploads.schemas.js';

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth);

// Devuelve { uploadUrl, key, publicUrl, maxBytes, contentType }
uploadsRouter.post('/presign', validate(presignSchema), uploadsController.presign);
