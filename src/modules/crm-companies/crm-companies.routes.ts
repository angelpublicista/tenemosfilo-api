import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { crmCompaniesController } from './crm-companies.controller.js';
import {
  createCrmCompanySchema,
  crmCompanyIdParamsSchema,
  listCrmCompaniesQuerySchema,
  updateCrmCompanySchema,
} from './crm-companies.schemas.js';

export const crmCompaniesRouter = Router();

crmCompaniesRouter.use(requireAuth);

crmCompaniesRouter.get(
  '/',
  validate(listCrmCompaniesQuerySchema, 'query'),
  crmCompaniesController.list,
);
crmCompaniesRouter.post('/', validate(createCrmCompanySchema), crmCompaniesController.create);

crmCompaniesRouter.get(
  '/:id',
  validate(crmCompanyIdParamsSchema, 'params'),
  crmCompaniesController.getById,
);

crmCompaniesRouter.patch(
  '/:id',
  validate(crmCompanyIdParamsSchema, 'params'),
  validate(updateCrmCompanySchema),
  crmCompaniesController.update,
);

crmCompaniesRouter.delete(
  '/:id',
  validate(crmCompanyIdParamsSchema, 'params'),
  crmCompaniesController.remove,
);

crmCompaniesRouter.post(
  '/:id/restore',
  validate(crmCompanyIdParamsSchema, 'params'),
  crmCompaniesController.restore,
);
