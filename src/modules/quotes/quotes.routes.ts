import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
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
  validate(searchExperiencesQuerySchema, 'query'),
  quotesController.searchExperiences,
);

quotesRouter.get('/', validate(listQuotesQuerySchema, 'query'), quotesController.list);
quotesRouter.post('/', validate(createQuoteSchema), quotesController.create);

quotesRouter.patch(
  '/:id/status',
  validate(quoteIdParamsSchema, 'params'),
  validate(updateQuoteStatusSchema),
  quotesController.updateStatus,
);
