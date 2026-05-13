import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/locationService.ts del front.
export const locationsRouter = Router();
locationsRouter.use(requireAuth);
locationsRouter.all('*', (_req, _res, next) => next(NotImplemented('Modulo locations pendiente')));
