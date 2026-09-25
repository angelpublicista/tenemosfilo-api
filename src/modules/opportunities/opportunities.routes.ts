import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { opportunitiesController } from './opportunities.controller.js';
import {
  crearSolicitudSchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdParamsSchema,
  updateOpportunitySchema,
} from './opportunities.schemas.js';

export const opportunitiesRouter = Router();

// Pipeline B2B del host: solo HOSTs/ADMINs.
opportunitiesRouter.use(requireAuth, requireRole('HOST', 'ADMIN'));

opportunitiesRouter.get(
  '/',
  requireScope('opportunities:read'),
  validate(listOpportunitiesQuerySchema, 'query'),
  opportunitiesController.list,
);
// El punto de entrada del CRM: clasificar y guardar lo minimo. Va antes que
// POST / para que la ruta no se confunda con un id.
opportunitiesRouter.post(
  '/solicitud',
  requireScope('opportunities:write'),
  validate(crearSolicitudSchema),
  opportunitiesController.crearSolicitud,
);

opportunitiesRouter.post(
  '/',
  requireScope('opportunities:write'),
  validate(createOpportunitySchema),
  opportunitiesController.create,
);

opportunitiesRouter.get(
  '/:id',
  requireScope('opportunities:read'),
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.getById,
);

opportunitiesRouter.patch(
  '/:id',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  validate(updateOpportunitySchema),
  opportunitiesController.update,
);

opportunitiesRouter.delete(
  '/:id',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.remove,
);
