import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { companiesController } from './companies.controller.js';
import {
  companyIdParamsSchema,
  createCompanyAsAdminSchema,
  embedDomainsSchema,
  listCompaniesQuerySchema,
  transferirTitularidadSchema,
  updateCompanySchema,
} from './companies.schemas.js';

export const companiesRouter = Router();

companiesRouter.use(requireAuth);

// Listado global de la plataforma: solo ADMIN. Va antes de /:id para que
// no lo capture la ruta parametrizada.
companiesRouter.get(
  '/',
  requireRole('ADMIN'),
  validate(listCompaniesQuerySchema, 'query'),
  companiesController.list,
);

// Mi company (la asociada al user logueado)
companiesRouter.get('/me', requireScope('companies:read'), companiesController.getMine);

// Todas mis empresas: un anfitrion puede tener varias. Va antes de /:id.
companiesRouter.get('/mine/all', requireScope('companies:read'), companiesController.listMine);

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
  validate(createCompanyAsAdminSchema),
  companiesController.create,
);

// Tambien RESELLER: desde que puede ser titular de una empresa, tiene que
// poder administrarla. Quien no sea su dueño se queda fuera igualmente —
// el servicio comprueba la propiedad, no basta con el rol.
companiesRouter.patch(
  '/:id',
  requireRole('HOST', 'RESELLER', 'ADMIN'),
  validate(companyIdParamsSchema, 'params'),
  validate(updateCompanySchema),
  companiesController.update,
);

// Dominios autorizados a insertar el catalogo. Lo gestiona el dueño.
companiesRouter.patch(
  '/:id/embed-domains',
  requireHumanAuth,
  validate(companyIdParamsSchema, 'params'),
  validate(embedDomainsSchema),
  companiesController.setEmbedDomains,
);

// Desactivar / reactivar una empresa (soft-delete). Solo ADMIN.
companiesRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate(companyIdParamsSchema, 'params'),
  companiesController.remove,
);

// Cambio de titular: mover una empresa a otra cuenta. Solo ADMIN, porque
// es un cambio de control sobre datos y dinero ajenos.
companiesRouter.patch(
  '/:id/owner',
  requireRole('ADMIN'),
  validate(companyIdParamsSchema, 'params'),
  validate(transferirTitularidadSchema),
  companiesController.transferirTitularidad,
);

companiesRouter.patch(
  '/:id/restore',
  requireRole('ADMIN'),
  validate(companyIdParamsSchema, 'params'),
  companiesController.restore,
);

// Asociar al user logueado a una company existente: solo humanos
companiesRouter.post(
  '/:id/associate-me',
  requireHumanAuth,
  validate(companyIdParamsSchema, 'params'),
  companiesController.associateMe,
);
