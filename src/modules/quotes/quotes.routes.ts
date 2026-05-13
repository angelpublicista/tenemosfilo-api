import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/quoteService.ts del front.
export const quotesRouter = Router();
quotesRouter.use(requireAuth);
quotesRouter.all('*', (_req, _res, next) => next(NotImplemented('Modulo quotes pendiente')));
