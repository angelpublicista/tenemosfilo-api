import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { requireScope } from '../../middleware/scope.js';
import { validate } from '../../middleware/validate.js';
import { opportunitiesController } from './opportunities.controller.js';
import {
  condicionDePagoSchema,
  crearPreReservaSchema,
  crearSolicitudSchema,
  perderSchema,
  registrarPagoSchema,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
  opportunityIdParamsSchema,
  updateOpportunitySchema,
} from './opportunities.schemas.js';

export const opportunitiesRouter = Router();

// Pipeline B2B del host: solo HOSTs/ADMINs.
opportunitiesRouter.use(requireAuth, requireRole('HOST', 'ADMIN'));

opportunitiesRouter.get(
  '/',
  requireScope('opportunities:read'),
  validate(listOpportunitiesQuerySchema, 'query'),
  opportunitiesController.list,
);
// El punto de entrada del CRM: clasificar y guardar lo minimo. Va antes que
// POST / para que la ruta no se confunda con un id.
// ── El tramo final: apartar, cobrar y cerrar ──────────────────────────────

// CRM-14/15. Medios de pago enviados: aparta el espacio. Solo en privadas.
opportunitiesRouter.post(
  '/:id/pre-reserva',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  validate(crearPreReservaSchema),
  opportunitiesController.crearPreReserva,
);

// Registrar un abono. Se acumula: un evento se paga en varios pagos.
opportunitiesRouter.post(
  '/:id/pago',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  validate(registrarPagoSchema),
  opportunitiesController.registrarPago,
);

// Autorizar una condicion distinta al abono. Queda quien la autorizo.
opportunitiesRouter.post(
  '/:id/condicion-de-pago',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  validate(condicionDePagoSchema),
  opportunitiesController.autorizarCondicion,
);

// CRM-17/18. Confirmar la venta: comprueba el minimo cobrado.
opportunitiesRouter.post(
  '/:id/confirmar-venta',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.confirmarVenta,
);

// CRM-19. Cerrar como perdida, con motivo. Libera el espacio apartado.
opportunitiesRouter.post(
  '/:id/perder',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  validate(perderSchema),
  opportunitiesController.perder,
);

// Registrar a mano que la propuesta ya salio, cuando se envio por fuera.
opportunitiesRouter.post(
  '/:id/propuesta-enviada',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.marcarPropuestaEnviada,
);

opportunitiesRouter.post(
  '/solicitud',
  requireScope('opportunities:write'),
  validate(crearSolicitudSchema),
  opportunitiesController.crearSolicitud,
);

opportunitiesRouter.post(
  '/',
  requireScope('opportunities:write'),
  validate(createOpportunitySchema),
  opportunitiesController.create,
);

opportunitiesRouter.get(
  '/:id',
  requireScope('opportunities:read'),
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.getById,
);

opportunitiesRouter.patch(
  '/:id',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  validate(updateOpportunitySchema),
  opportunitiesController.update,
);

opportunitiesRouter.delete(
  '/:id',
  requireScope('opportunities:write'),
  validate(opportunityIdParamsSchema, 'params'),
  opportunitiesController.remove,
);
