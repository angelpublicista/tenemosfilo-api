import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/availabilityService.ts del front.
export const availabilitiesRouter = Router();
availabilitiesRouter.use(requireAuth);
availabilitiesRouter.all('*', (_req, _res, next) =>
  next(NotImplemented('Modulo availabilities pendiente')),
);
