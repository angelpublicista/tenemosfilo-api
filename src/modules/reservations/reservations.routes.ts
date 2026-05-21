import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { reservationsController } from './reservations.controller.js';
import {
  cancelSchema,
  createReservationSchema,
  listReservationsQuerySchema,
  reservationIdParamsSchema,
  rescheduleSchema,
  updatePaymentStatusSchema,
  updateReservationSchema,
  updateStatusSchema,
} from './reservations.schemas.js';

export const reservationsRouter = Router();

// Endpoint publico (sin auth) para el booking engine.
reservationsRouter.post(
  '/public',
  validate(createReservationSchema),
  reservationsController.createPublic,
);

// El resto requiere auth
reservationsRouter.use(requireAuth);

reservationsRouter.get(
  '/stats/by-company/:companyId',
  requireRole('HOST', 'ADMIN'),
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  reservationsController.stats,
);

reservationsRouter.get(
  '/',
  requireRole('HOST', 'ADMIN'),
  validate(listReservationsQuerySchema, 'query'),
  reservationsController.list,
);

// Crear reserva: HOST en su company o RESELLER en nombre de un cliente.
reservationsRouter.post(
  '/',
  requireScope('reservations:write'),
  validate(createReservationSchema),
  reservationsController.create,
);

reservationsRouter.get(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  reservationsController.getById,
);

reservationsRouter.patch(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(updateReservationSchema),
  reservationsController.update,
);

reservationsRouter.patch(
  '/:id/status',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(updateStatusSchema),
  reservationsController.updateStatus,
);

reservationsRouter.patch(
  '/:id/payment-status',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(updatePaymentStatusSchema),
  reservationsController.updatePaymentStatus,
);

reservationsRouter.post(
  '/:id/cancel',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(cancelSchema),
  reservationsController.cancel,
);

reservationsRouter.post(
  '/:id/reschedule',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(rescheduleSchema),
  reservationsController.reschedule,
);

reservationsRouter.delete(
  '/:id',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  reservationsController.remove,
);
