import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/companyService.ts del front.
export const companiesRouter = Router();
companiesRouter.use(requireAuth);
companiesRouter.all('*', (_req, _res, next) => next(NotImplemented('Modulo companies pendiente')));
