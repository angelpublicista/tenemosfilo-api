import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
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

locationsRouter.get('/', validate(listLocationsQuerySchema, 'query'), locationsController.list);
locationsRouter.post('/', validate(createLocationSchema), locationsController.create);

locationsRouter.get(
  '/:id',
  validate(locationIdParamsSchema, 'params'),
  locationsController.getById,
);

locationsRouter.patch(
  '/:id',
  validate(locationIdParamsSchema, 'params'),
  validate(updateLocationSchema),
  locationsController.update,
);

locationsRouter.delete(
  '/:id',
  validate(locationIdParamsSchema, 'params'),
  locationsController.remove,
);

locationsRouter.post(
  '/:id/set-main',
  validate(locationIdParamsSchema, 'params'),
  locationsController.setMain,
);
