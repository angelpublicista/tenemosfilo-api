import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/integrationService.ts del front.
export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);
integrationsRouter.all('*', (_req, _res, next) =>
  next(NotImplemented('Modulo integrations pendiente')),
);
