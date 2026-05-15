import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
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
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  reservationsController.stats,
);

reservationsRouter.get('/', validate(listReservationsQuerySchema, 'query'), reservationsController.list);

reservationsRouter.post('/', validate(createReservationSchema), reservationsController.create);

reservationsRouter.get(
  '/:id',
  validate(reservationIdParamsSchema, 'params'),
  reservationsController.getById,
);

reservationsRouter.patch(
  '/:id',
  validate(reservationIdParamsSchema, 'params'),
  validate(updateReservationSchema),
  reservationsController.update,
);

reservationsRouter.patch(
  '/:id/status',
  validate(reservationIdParamsSchema, 'params'),
  validate(updateStatusSchema),
  reservationsController.updateStatus,
);

reservationsRouter.patch(
  '/:id/payment-status',
  validate(reservationIdParamsSchema, 'params'),
  validate(updatePaymentStatusSchema),
  reservationsController.updatePaymentStatus,
);

reservationsRouter.post(
  '/:id/cancel',
  validate(reservationIdParamsSchema, 'params'),
  validate(cancelSchema),
  reservationsController.cancel,
);

reservationsRouter.post(
  '/:id/reschedule',
  validate(reservationIdParamsSchema, 'params'),
  validate(rescheduleSchema),
  reservationsController.reschedule,
);

reservationsRouter.delete(
  '/:id',
  validate(reservationIdParamsSchema, 'params'),
  reservationsController.remove,
);
