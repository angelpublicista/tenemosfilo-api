import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { quotesController } from './quotes.controller.js';
import {
  createQuoteSchema,
  listQuotesQuerySchema,
  quoteIdParamsSchema,
  searchExperiencesQuerySchema,
  updateQuoteStatusSchema,
} from './quotes.schemas.js';

export const quotesRouter = Router();

quotesRouter.use(requireAuth);

quotesRouter.get(
  '/search-experiences',
  requireScope('experiences:read'),
  validate(searchExperiencesQuerySchema, 'query'),
  quotesController.searchExperiences,
);

// Listado de quotes: solo HOST (ve los suyos).
quotesRouter.get(
  '/',
  requireRole('HOST', 'ADMIN'),
  validate(listQuotesQuerySchema, 'query'),
  quotesController.list,
);

// Crear quote: HOST en su company o RESELLER en nombre de un cliente.
quotesRouter.post(
  '/',
  requireScope('quotes:write'),
  validate(createQuoteSchema),
  quotesController.create,
);

quotesRouter.patch(
  '/:id/status',
  requireRole('HOST', 'ADMIN'),
  validate(quoteIdParamsSchema, 'params'),
  validate(updateQuoteStatusSchema),
  quotesController.updateStatus,
);
