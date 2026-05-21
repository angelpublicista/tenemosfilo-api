import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { locationsController } from './locations.controller.js';
import {
  createLocationSchema,
  listLocationsQuerySchema,
  locationIdParamsSchema,
  updateLocationSchema,
} from './locations.schemas.js';

export const locationsRouter = Router();

locationsRouter.use(requireAuth);

locationsRouter.get(
  '/',
  requireScope('locations:read'),
  validate(listLocationsQuerySchema, 'query'),
  locationsController.list,
);
locationsRouter.post(
  '/',
  requireRole('HOST', 'ADMIN'),
  validate(createLocationSchema),
  locationsController.create,
);

locationsRouter.get(
  '/:id',
  requireScope('locations:read'),
  validate(locationIdParamsSchema, 'params'),
  locationsController.getById,
);

locationsRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(locationIdParamsSchema, 'params'),
  validate(updateLocationSchema),
  locationsController.update,
);

locationsRouter.delete(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(locationIdParamsSchema, 'params'),
  locationsController.remove,
);

locationsRouter.post(
  '/:id/set-main',
  requireRole('HOST', 'ADMIN'),
  validate(locationIdParamsSchema, 'params'),
  locationsController.setMain,
);
