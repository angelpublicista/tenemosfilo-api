import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { availabilitiesController } from './availabilities.controller.js';
import {
  availabilityIdParamsSchema,
  createAvailabilitySchema,
  listAvailabilitiesQuerySchema,
  setPrimarySchema,
  updateAvailabilitySchema,
} from './availabilities.schemas.js';

export const availabilitiesRouter = Router();

availabilitiesRouter.use(requireAuth);

availabilitiesRouter.get(
  '/',
  validate(listAvailabilitiesQuerySchema, 'query'),
  availabilitiesController.list,
);
availabilitiesRouter.post('/', validate(createAvailabilitySchema), availabilitiesController.create);

availabilitiesRouter.get(
  '/:id',
  validate(availabilityIdParamsSchema, 'params'),
  availabilitiesController.getById,
);

availabilitiesRouter.patch(
  '/:id',
  validate(availabilityIdParamsSchema, 'params'),
  validate(updateAvailabilitySchema),
  availabilitiesController.update,
);

availabilitiesRouter.delete(
  '/:id',
  validate(availabilityIdParamsSchema, 'params'),
  availabilitiesController.remove,
);

availabilitiesRouter.post(
  '/:id/set-primary',
  validate(availabilityIdParamsSchema, 'params'),
  validate(setPrimarySchema),
  availabilitiesController.setPrimary,
);
