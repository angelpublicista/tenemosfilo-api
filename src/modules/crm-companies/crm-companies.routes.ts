import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { crmCompaniesController } from './crm-companies.controller.js';
import {
  createCrmCompanySchema,
  crmCompanyIdParamsSchema,
  listCrmCompaniesQuerySchema,
  updateCrmCompanySchema,
} from './crm-companies.schemas.js';

export const crmCompaniesRouter = Router();

// CRM B2B del host: solo HOSTs/ADMINs.
crmCompaniesRouter.use(requireAuth, requireRole('HOST', 'ADMIN'));

crmCompaniesRouter.get(
  '/',
  requireScope('crm-companies:read'),
  validate(listCrmCompaniesQuerySchema, 'query'),
  crmCompaniesController.list,
);
crmCompaniesRouter.post(
  '/',
  requireScope('crm-companies:write'),
  validate(createCrmCompanySchema),
  crmCompaniesController.create,
);

crmCompaniesRouter.get(
  '/:id',
  requireScope('crm-companies:read'),
  validate(crmCompanyIdParamsSchema, 'params'),
  crmCompaniesController.getById,
);

crmCompaniesRouter.patch(
  '/:id',
  requireScope('crm-companies:write'),
  validate(crmCompanyIdParamsSchema, 'params'),
  validate(updateCrmCompanySchema),
  crmCompaniesController.update,
);

crmCompaniesRouter.delete(
  '/:id',
  requireScope('crm-companies:write'),
  validate(crmCompanyIdParamsSchema, 'params'),
  crmCompaniesController.remove,
);

crmCompaniesRouter.post(
  '/:id/restore',
  requireScope('crm-companies:write'),
  validate(crmCompanyIdParamsSchema, 'params'),
  crmCompaniesController.restore,
);
