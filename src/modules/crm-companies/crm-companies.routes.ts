import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/crmCompanyService.ts del front.
export const crmCompaniesRouter = Router();
crmCompaniesRouter.use(requireAuth);
crmCompaniesRouter.all('*', (_req, _res, next) =>
  next(NotImplemented('Modulo crm-companies pendiente')),
);
