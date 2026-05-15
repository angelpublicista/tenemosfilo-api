import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { companiesController } from './companies.controller.js';
import {
  companyIdParamsSchema,
  createCompanySchema,
  updateCompanySchema,
} from './companies.schemas.js';

export const companiesRouter = Router();

companiesRouter.use(requireAuth);

// Mi company (la asociada al user logueado)
companiesRouter.get('/me', companiesController.getMine);

// Owned by a specific user (para flujos donde tenemos el ownerId)
companiesRouter.get(
  '/by-owner/:userId',
  validate(z.object({ userId: z.string().min(1) }), 'params'),
  companiesController.getByOwner,
);

companiesRouter.get(
  '/slug/:slug',
  validate(z.object({ slug: z.string().min(1) }), 'params'),
  companiesController.getBySlug,
);

companiesRouter.get(
  '/:id',
  validate(companyIdParamsSchema, 'params'),
  companiesController.getById,
);

companiesRouter.post('/', validate(createCompanySchema), companiesController.create);

companiesRouter.patch(
  '/:id',
  validate(companyIdParamsSchema, 'params'),
  validate(updateCompanySchema),
  companiesController.update,
);

// Asociar al user logueado a una company existente
companiesRouter.post(
  '/:id/associate-me',
  validate(companyIdParamsSchema, 'params'),
  companiesController.associateMe,
);
