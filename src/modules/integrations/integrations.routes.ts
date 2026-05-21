import { Router } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { integrationsController } from './integrations.controller.js';
import {
  createIntegrationSchema,
  integrationIdParamsSchema,
  listIntegrationsQuerySchema,
  updateIntegrationSchema,
  updateStatusSchema,
} from './integrations.schemas.js';

export const integrationsRouter = Router();

// /integrations almacena tokens OAuth del usuario; no se expone via API key.
integrationsRouter.use(requireAuth, requireHumanAuth);

integrationsRouter.get('/stats', integrationsController.stats);
integrationsRouter.get(
  '/',
  validate(listIntegrationsQuerySchema, 'query'),
  integrationsController.list,
);
integrationsRouter.post('/', validate(createIntegrationSchema), integrationsController.create);

integrationsRouter.get(
  '/:id',
  validate(integrationIdParamsSchema, 'params'),
  integrationsController.getById,
);

integrationsRouter.patch(
  '/:id',
  validate(integrationIdParamsSchema, 'params'),
  validate(updateIntegrationSchema),
  integrationsController.update,
);

integrationsRouter.patch(
  '/:id/status',
  validate(integrationIdParamsSchema, 'params'),
  validate(updateStatusSchema),
  integrationsController.updateStatus,
);

integrationsRouter.delete(
  '/:id',
  validate(integrationIdParamsSchema, 'params'),
  integrationsController.remove,
);
