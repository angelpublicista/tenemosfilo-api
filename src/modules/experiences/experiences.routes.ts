import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { experiencesController } from './experiences.controller.js';
import {
  condicionesDeSedeSchema,
  createExperienceSchema,
  experienceIdParamsSchema,
  featuredQuerySchema,
  listExperiencesQuerySchema,
  sedeParamsSchema,
  updateExperienceSchema,
  updateStatusSchema,
} from './experiences.schemas.js';

export const experiencesRouter = Router();

experiencesRouter.use(requireAuth);

experiencesRouter.get(
  '/featured',
  requireScope('experiences:read'),
  validate(featuredQuerySchema, 'query'),
  experiencesController.featured,
);

experiencesRouter.get(
  '/stats/by-company/:companyId',
  requireRole('HOST', 'ADMIN'),
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  experiencesController.stats,
);

experiencesRouter.get(
  '/',
  requireScope('experiences:read'),
  validate(listExperiencesQuerySchema, 'query'),
  experiencesController.list,
);

experiencesRouter.post(
  '/',
  requireRole('HOST', 'ADMIN'),
  validate(createExperienceSchema),
  experiencesController.create,
);

experiencesRouter.get(
  '/:id',
  requireScope('experiences:read'),
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.getById,
);

// TR-24. Las notas del comensal por dimension.
experiencesRouter.get(
  '/:id/notas',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.notas,
);

experiencesRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  validate(updateExperienceSchema),
  experiencesController.update,
);

// La experiencia en cada sede: la misma pieza puede estar en un sitio como
// abierta y en otro como privada, con otro aforo y otra anticipacion.
experiencesRouter.get(
  '/:id/sedes',
  requireScope('experiences:read'),
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.sedes,
);

experiencesRouter.put(
  '/:id/sedes/:locationId',
  requireRole('HOST', 'ADMIN'),
  validate(sedeParamsSchema, 'params'),
  validate(condicionesDeSedeSchema),
  experiencesController.fijarSede,
);

// Borrar la ficha es volver a las condiciones de la experiencia, no quitar la
// sede: donde se ofrece lo sigue diciendo la lista de sedes de la experiencia.
experiencesRouter.delete(
  '/:id/sedes/:locationId',
  requireRole('HOST', 'ADMIN'),
  validate(sedeParamsSchema, 'params'),
  experiencesController.soltarSede,
);

experiencesRouter.patch(
  '/:id/status',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  validate(updateStatusSchema),
  experiencesController.updateStatus,
);

experiencesRouter.delete(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(experienceIdParamsSchema, 'params'),
  experiencesController.remove,
);
