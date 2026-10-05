import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { limiteReservaPublica } from '../../middleware/rate-limit.js';
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
  validarCodigoSchema,
  reembolsoSchema,
  deMiCanalQuerySchema,
  cargoAdicionalSchema,
} from './reservations.schemas.js';

export const reservationsRouter = Router();

// Endpoint publico (sin auth) para el booking engine.
reservationsRouter.post(
  '/public',
  limiteReservaPublica,
  validate(createReservationSchema),
  reservationsController.createPublic,
);

// El resto requiere auth
reservationsRouter.use(requireAuth);

// Las reservas de quien llama, como cliente. Sin requireRole: cualquiera
// que reserve — comensal, anfitrion o revendedor — puede ver las suyas.
// Va antes de /:id para que "mine" no se tome por un id.
reservationsRouter.get('/mine', requireHumanAuth, reservationsController.mias);

// TR-25. Lo que vendio un canal, con la asistencia. Va antes de /:id para que
// "de-mi-canal" no se lea como el id de una reserva.
//
// Lo abre tambien un ADMIN actuando como la empresa revendedora, que es como
// se revisa un canal desde dentro sin pedirle sus credenciales.
reservationsRouter.get(
  '/de-mi-canal',
  requireRole('RESELLER', 'ADMIN'),
  validate(deMiCanalQuerySchema, 'query'),
  reservationsController.deMiCanal,
);

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

// Validar en la puerta el codigo que trae el cliente. Va ANTES de /:id para
// que "validar-codigo" no se lea como un id de reserva.
//
// No la abre un revendedor: quien recibe a la gente es el anfitrion, y es el
// quien tiene que ver si aparece alguien sin reserva en FILO.
reservationsRouter.post(
  '/validar-codigo',
  requireRole('HOST', 'ADMIN'),
  requireHumanAuth,
  validate(validarCodigoSchema),
  reservationsController.validarCodigo,
);

// Ver una reserva. El servicio comprueba ademas que sea suya: el rol solo
// dice que clase de actor es, no a quien pertenece la reserva.
//
// RESELLER entra aqui —no podia antes— porque se le avisa de las ventas de su
// canal por correo y por la campana, y esos avisos enlazan a la reserva. Solo
// alcanza las suyas: las que vendio el. Gestionarlas sigue siendo del
// anfitrion, y esas rutas no lo admiten.
reservationsRouter.get(
  '/:id',
  requireRole('HOST', 'ADMIN', 'RESELLER'),
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

// TR-30. Reembolsos de una reserva que sigue en pie: se registran aqui y
// ajustan la venta y la base del fee.
reservationsRouter.get(
  '/:id/reembolsos',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  reservationsController.reembolsos,
);

reservationsRouter.post(
  '/:id/reembolsos',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(reembolsoSchema),
  reservationsController.reembolsar,
);

reservationsRouter.post(
  '/:id/reembolsos/:refundId/pagado',
  requireRole('HOST', 'ADMIN'),
  validate(
    z.object({ id: z.string().min(1), refundId: z.string().min(1) }),
    'params',
  ),
  reservationsController.marcarReembolsoPagado,
);

// TR-12. Cargos adicionales acordados despues de vender. Suman al total y a
// la base del fee; el precio original no se toca.
reservationsRouter.post(
  '/:id/cargos',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  validate(cargoAdicionalSchema),
  reservationsController.cargoAdicional,
);

// TR-39. Que le fue pasando a esta reserva: cambios, cargos, reembolsos.
reservationsRouter.get(
  '/:id/historial',
  requireRole('HOST', 'ADMIN'),
  validate(reservationIdParamsSchema, 'params'),
  reservationsController.historial,
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
