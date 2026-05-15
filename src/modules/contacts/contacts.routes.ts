import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { contactsController } from './contacts.controller.js';
import {
  contactIdParamsSchema,
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
} from './contacts.schemas.js';

export const contactsRouter = Router();

contactsRouter.use(requireAuth);

contactsRouter.get('/', validate(listContactsQuerySchema, 'query'), contactsController.list);
contactsRouter.post('/', validate(createContactSchema), contactsController.create);

contactsRouter.get(
  '/:id',
  validate(contactIdParamsSchema, 'params'),
  contactsController.getById,
);

contactsRouter.patch(
  '/:id',
  validate(contactIdParamsSchema, 'params'),
  validate(updateContactSchema),
  contactsController.update,
);

contactsRouter.delete(
  '/:id',
  validate(contactIdParamsSchema, 'params'),
  contactsController.remove,
);

contactsRouter.post(
  '/:id/restore',
  validate(contactIdParamsSchema, 'params'),
  contactsController.restore,
);
