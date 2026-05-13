import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { usersController } from './users.controller.js';
import { listUsersQuerySchema, updateUserSchema, userIdParamsSchema } from './users.schemas.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/me', usersController.me);

usersRouter.get('/', requireRole('ADMIN'), validate(listUsersQuerySchema, 'query'), usersController.list);

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
