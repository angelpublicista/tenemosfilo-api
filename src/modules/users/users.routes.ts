import { Router } from 'express';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { usersController } from './users.controller.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  userIdParamsSchema,
} from './users.schemas.js';

export const usersRouter = Router();

// /users no es accesible por API keys: la administracion de usuarios
// es solo para humanos (HOST/ADMIN logueados).
usersRouter.use(requireAuth, requireHumanAuth);

usersRouter.get('/me', usersController.me);

usersRouter.get('/', requireRole('ADMIN'), validate(listUsersQuerySchema, 'query'), usersController.list);

// Alta manual desde el panel. /auth/register es la via publica y solo
// admite HOST/GUEST; esta admite cualquier rol y empresa.
usersRouter.post('/', requireRole('ADMIN'), validate(createUserSchema), usersController.create);

// Reenviar la invitacion: el enlace caduca en 7 dias y los correos se
// pierden. Sin esto, la unica salida seria borrar al usuario y recrearlo.
usersRouter.post(
  '/:id/invite',
  requireRole('ADMIN'),
  validate(userIdParamsSchema, 'params'),
  usersController.reinvitar,
);

usersRouter.get('/:id', validate(userIdParamsSchema, 'params'), usersController.getById);

usersRouter.patch(
  '/:id',
  validate(userIdParamsSchema, 'params'),
  validate(updateUserSchema),
  usersController.update,
);

usersRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate(userIdParamsSchema, 'params'),
  usersController.remove,
);
