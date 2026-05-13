import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/opportunityService.ts del front.
export const opportunitiesRouter = Router();
opportunitiesRouter.use(requireAuth);
opportunitiesRouter.all('*', (_req, _res, next) =>
  next(NotImplemented('Modulo opportunities pendiente')),
);
