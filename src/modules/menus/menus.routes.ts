import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { menusController } from './menus.controller.js';
import {
  createMenuSchema,
  listMenusQuerySchema,
  menuIdParamsSchema,
  updateMenuSchema,
} from './menus.schemas.js';

export const menusRouter = Router();

menusRouter.use(requireAuth);

menusRouter.get(
  '/',
  requireScope('menus:read'),
  validate(listMenusQuerySchema, 'query'),
  menusController.list,
);

// Como en sedes, las escrituras son de HOST y ADMIN: un revendedor vende lo
// de otros, no edita su carta.
menusRouter.post(
  '/',
  requireRole('HOST', 'ADMIN'),
  requireScope('menus:write'),
  validate(createMenuSchema),
  menusController.create,
);

menusRouter.get(
  '/:id',
  requireScope('menus:read'),
  validate(menuIdParamsSchema, 'params'),
  menusController.getById,
);

menusRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  requireScope('menus:write'),
  validate(menuIdParamsSchema, 'params'),
  validate(updateMenuSchema),
  menusController.update,
);

menusRouter.delete(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  requireScope('menus:write'),
  validate(menuIdParamsSchema, 'params'),
  menusController.remove,
);
