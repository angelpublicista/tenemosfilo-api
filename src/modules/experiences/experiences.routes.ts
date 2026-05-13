import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/experienceService.ts del front.
export const experiencesRouter = Router();
experiencesRouter.use(requireAuth);
experiencesRouter.all('*', (_req, _res, next) =>
  next(NotImplemented('Modulo experiences pendiente')),
);
