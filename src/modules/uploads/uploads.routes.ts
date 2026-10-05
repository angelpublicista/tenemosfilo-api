import { Router } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploadsController } from './uploads.controller.js';
import { copiarDesdeUrlSchema, firmaLecturaSchema, presignSchema } from './uploads.schemas.js';

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

// Copia a nuestro bucket una imagen que el anfitrion eligio del catalogo de su
// propia web. La descarga comprueba el destino en cada redireccion: una URL
// escrita por un usuario puede apuntar a nuestra red interna.
uploadsRouter.post(
  '/copiar-desde-url',
  validate(copiarDesdeUrlSchema),
  uploadsController.copiarDesdeUrl,
);
