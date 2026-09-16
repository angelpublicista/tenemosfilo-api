import { Router } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploadsController } from './uploads.controller.js';
import { firmaLecturaSchema, presignSchema } from './uploads.schemas.js';

export const uploadsRouter = Router();

// Subidas firmadas solo para humanos por ahora; abrir a API keys requiere
// un scope dedicado y cuotas (pendiente).
uploadsRouter.use(requireAuth, requireHumanAuth);

// Devuelve { uploadUrl, key, publicUrl, maxBytes, contentType }.
// `publicUrl` es null cuando se pide visibilidad privada: esos ficheros no
// tienen una URL que se pueda servir.
uploadsRouter.post('/presign', validate(presignSchema), uploadsController.presign);

// Enlace temporal para abrir un documento privado. El servicio comprueba que
// quien pregunta tenga algo que ver con el.
uploadsRouter.get(
  '/firma-lectura',
  validate(firmaLecturaSchema, 'query'),
  uploadsController.firmarLectura,
);
