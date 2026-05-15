import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { experiencesController } from './experiences.controller.js';
import {
  createExperienceSchema,
  experienceIdParamsSchema,
  featuredQuerySchema,
  listExperiencesQuerySchema,
  updateExperienceSchema,
  updateStatusSchema,
} from './experiences.schemas.js';

export const experiencesRouter = Router();

experiencesRouter.use(requireAuth);

experiencesRouter.get(
  '/featured',
  validate(featuredQuerySchema, 'query'),
  experiencesController.featured,
);

experiencesRouter.get(
  '/stats/by-company/:companyId',
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  experiencesController.stats,
);

experiencesRouter.get('/', validate(listExperiencesQuerySchema, 'query'), experiencesController.list);

experiencesRouter.post('/', validate(createExperienceSchema), experiencesController.create);

experiencesRouter.get(
  '/:id',
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.getById,
);

experiencesRouter.patch(
  '/:id',
  validate(experienceIdParamsSchema, 'params'),
  validate(updateExperienceSchema),
  experiencesController.update,
);

experiencesRouter.patch(
  '/:id/status',
  validate(experienceIdParamsSchema, 'params'),
  validate(updateStatusSchema),
  experiencesController.updateStatus,
);

experiencesRouter.delete(
  '/:id',
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.remove,
);
