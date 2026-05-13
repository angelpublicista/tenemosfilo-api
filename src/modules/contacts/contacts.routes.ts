import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { NotImplemented } from '../../lib/errors.js';

// TODO: implementar reemplazando src/lib/sanity/contactService.ts del front.
export const contactsRouter = Router();
contactsRouter.use(requireAuth);
contactsRouter.all('*', (_req, _res, next) => next(NotImplemented('Modulo contacts pendiente')));
