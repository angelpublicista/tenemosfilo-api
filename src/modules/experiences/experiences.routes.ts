import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
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
  requireScope('experiences:read'),
  validate(featuredQuerySchema, 'query'),
  experiencesController.featured,
);

experiencesRouter.get(
  '/stats/by-company/:companyId',
  requireRole('HOST', 'ADMIN'),
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  experiencesController.stats,
);

experiencesRouter.get(
  '/',
  requireScope('experiences:read'),
  validate(listExperiencesQuerySchema, 'query'),
  experiencesController.list,
);

experiencesRouter.post(
  '/',
  requireRole('HOST', 'ADMIN'),
  validate(createExperienceSchema),
  experiencesController.create,
);

experiencesRouter.get(
  '/:id',
  requireScope('experiences:read'),
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.getById,
);

experiencesRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  validate(updateExperienceSchema),
  experiencesController.update,
);

experiencesRouter.patch(
  '/:id/status',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  validate(updateStatusSchema),
  experiencesController.updateStatus,
);

experiencesRouter.delete(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.remove,
);
