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

// Marcar una cotizacion como enviada. Es lo que mueve la oportunidad a
// "Propuesta enviada" sin que nadie tenga que acordarse.
quotesRouter.post(
  '/:id/enviada',
  requireScope('quotes:write'),
  validate(quoteIdParamsSchema, 'params'),
  quotesController.marcarEnviada,
);

// El historial de cotizaciones de una oportunidad, con cual es la vigente.
quotesRouter.get(
  '/por-oportunidad/:id',
  requireScope('quotes:read'),
  validate(quoteIdParamsSchema, 'params'),
  quotesController.porOportunidad,
);


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
