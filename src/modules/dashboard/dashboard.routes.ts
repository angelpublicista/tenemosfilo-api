import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { dashboardController } from './dashboard.controller.js';
import { activitiesQuerySchema, statsQuerySchema } from './dashboard.schemas.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/stats', validate(statsQuerySchema, 'query'), dashboardController.stats);
dashboardRouter.get(
  '/recent-activities',
  validate(activitiesQuerySchema, 'query'),
  dashboardController.activities,
);
