import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { opportunitiesController } from './opportunities.controller.js';
import {
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdParamsSchema,
  updateOpportunitySchema,
} from './opportunities.schemas.js';

export const opportunitiesRouter = Router();

opportunitiesRouter.use(requireAuth);

opportunitiesRouter.get(
  '/',
  validate(listOpportunitiesQuerySchema, 'query'),
  opportunitiesController.list,
);
opportunitiesRouter.post('/', validate(createOpportunitySchema), opportunitiesController.create);

opportunitiesRouter.get(
  '/:id',
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.getById,
);

opportunitiesRouter.patch(
  '/:id',
  validate(opportunityIdParamsSchema, 'params'),
  validate(updateOpportunitySchema),
  opportunitiesController.update,
);

opportunitiesRouter.delete(
  '/:id',
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.remove,
);
