import { Router } from 'express';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { apiKeysController } from './api-keys.controller.js';
import {
  apiKeyIdParamsSchema,
  createApiKeySchema,
  updateApiKeySchema,
} from './api-keys.schemas.js';

export const apiKeysRouter = Router();

// La administracion de API keys siempre va por JWT humano (RESELLER o ADMIN).
// requireHumanAuth bloquea que una API key cree/revoque otras keys.
// Los HOSTs (operadores de restaurante) no emiten API keys: el API publico es
// para canales de venta tipo Reseller.
apiKeysRouter.use(requireAuth, requireHumanAuth, requireRole('RESELLER', 'ADMIN'));

apiKeysRouter.get('/', apiKeysController.list);

apiKeysRouter.post('/', validate(createApiKeySchema), apiKeysController.create);

apiKeysRouter.get(
  '/:id',
  validate(apiKeyIdParamsSchema, 'params'),
  apiKeysController.getById,
);

apiKeysRouter.patch(
  '/:id',
  validate(apiKeyIdParamsSchema, 'params'),
  validate(updateApiKeySchema),
  apiKeysController.update,
);

apiKeysRouter.delete(
  '/:id',
  validate(apiKeyIdParamsSchema, 'params'),
  apiKeysController.revoke,
);
