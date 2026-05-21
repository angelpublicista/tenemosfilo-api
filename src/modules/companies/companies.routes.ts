import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
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
companiesRouter.get('/me', requireScope('companies:read'), companiesController.getMine);

// Owned by a specific user (para flujos donde tenemos el ownerId)
companiesRouter.get(
  '/by-owner/:userId',
  requireScope('companies:read'),
  validate(z.object({ userId: z.string().min(1) }), 'params'),
  companiesController.getByOwner,
);

companiesRouter.get(
  '/slug/:slug',
  requireScope('companies:read'),
  validate(z.object({ slug: z.string().min(1) }), 'params'),
  companiesController.getBySlug,
);

companiesRouter.get(
  '/:id',
  requireScope('companies:read'),
  validate(companyIdParamsSchema, 'params'),
  companiesController.getById,
);

// Crear company es solo para usuarios humanos (no via API key)
companiesRouter.post(
  '/',
  requireHumanAuth,
  validate(createCompanySchema),
  companiesController.create,
);

companiesRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(companyIdParamsSchema, 'params'),
  validate(updateCompanySchema),
  companiesController.update,
);

// Asociar al user logueado a una company existente: solo humanos
companiesRouter.post(
  '/:id/associate-me',
  requireHumanAuth,
  validate(companyIdParamsSchema, 'params'),
  companiesController.associateMe,
);
