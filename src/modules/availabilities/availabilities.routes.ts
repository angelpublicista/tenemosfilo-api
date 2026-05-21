import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
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
  requireScope('availabilities:read'),
  validate(listAvailabilitiesQuerySchema, 'query'),
  availabilitiesController.list,
);
availabilitiesRouter.post(
  '/',
  requireRole('HOST', 'ADMIN'),
  validate(createAvailabilitySchema),
  availabilitiesController.create,
);

availabilitiesRouter.get(
  '/:id',
  requireScope('availabilities:read'),
  validate(availabilityIdParamsSchema, 'params'),
  availabilitiesController.getById,
);

availabilitiesRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(availabilityIdParamsSchema, 'params'),
  validate(updateAvailabilitySchema),
  availabilitiesController.update,
);

availabilitiesRouter.delete(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(availabilityIdParamsSchema, 'params'),
  availabilitiesController.remove,
);

availabilitiesRouter.post(
  '/:id/set-primary',
  requireRole('HOST', 'ADMIN'),
  validate(availabilityIdParamsSchema, 'params'),
  validate(setPrimarySchema),
  availabilitiesController.setPrimary,
);
