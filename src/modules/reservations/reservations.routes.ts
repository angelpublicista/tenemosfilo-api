import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/reservationService.ts del front.
export const reservationsRouter = Router();
reservationsRouter.use(requireAuth);
reservationsRouter.all('*', (_req, _res, next) =>
  next(NotImplemented('Modulo reservations pendiente')),
);
