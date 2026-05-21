import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { dashboardController } from './dashboard.controller.js';
import { activitiesQuerySchema, statsQuerySchema } from './dashboard.schemas.js';

export const dashboardRouter = Router();

// Dashboard ejecutivo del host: solo HOSTs/ADMINs.
dashboardRouter.use(requireAuth, requireRole('HOST', 'ADMIN'));

dashboardRouter.get(
  '/stats',
  requireScope('dashboard:read'),
  validate(statsQuerySchema, 'query'),
  dashboardController.stats,
);
dashboardRouter.get(
  '/recent-activities',
  requireScope('dashboard:read'),
  validate(activitiesQuerySchema, 'query'),
  dashboardController.activities,
);
