import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { contactsController } from './contacts.controller.js';
import {
  contactIdParamsSchema,
  createContactSchema,
  importarContactosSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from './contacts.schemas.js';

export const contactsRouter = Router();

// CRM de contactos: solo HOSTs/ADMINs. Los Resellers no gestionan contactos
// del host (esa data es propia del operador del restaurante).
contactsRouter.use(requireAuth, requireRole('HOST', 'ADMIN'));

contactsRouter.get(
  '/',
  requireScope('contacts:read'),
  validate(listContactsQuerySchema, 'query'),
  contactsController.list,
);
contactsRouter.post(
  '/',
  requireScope('contacts:write'),
  validate(createContactSchema),
  contactsController.create,
);

// CRM-30. Importacion masiva desde una hoja de calculo. Va antes de /:id para
// que "importar" no se lea como el id de un contacto.
contactsRouter.post(
  '/importar',
  requireScope('contacts:write'),
  validate(importarContactosSchema),
  contactsController.importar,
);

contactsRouter.get(
  '/:id',
  requireScope('contacts:read'),
  validate(contactIdParamsSchema, 'params'),
  contactsController.getById,
);

contactsRouter.patch(
  '/:id',
  requireScope('contacts:write'),
  validate(contactIdParamsSchema, 'params'),
  validate(updateContactSchema),
  contactsController.update,
);

contactsRouter.delete(
  '/:id',
  requireScope('contacts:write'),
  validate(contactIdParamsSchema, 'params'),
  contactsController.remove,
);

contactsRouter.post(
  '/:id/restore',
  requireScope('contacts:write'),
  validate(contactIdParamsSchema, 'params'),
  contactsController.restore,
);
