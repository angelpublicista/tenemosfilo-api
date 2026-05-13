import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/dashboardService.ts del front.
// Endpoints esperados: GET /dashboard/stats, /dashboard/revenue, /dashboard/upcoming-reservations.
export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.all('*', (_req, _res, next) => next(NotImplemented('Modulo dashboard pendiente')));
