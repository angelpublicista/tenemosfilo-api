import { z } from 'zod';

const statusEnum = z.enum([
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);
const paymentStatusEnum = z.enum(['PENDING', 'PAID', 'REFUNDED', 'PARTIAL', 'FAILED']);
const clientTypeEnum = z.enum(['GUEST', 'REGISTERED']);
const sourceEnum = z.enum(['MANUAL', 'BOOKING_ENGINE', 'QUOTE']);

const clientSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().default(''),
  companyName: z.string().optional(),
  contactPerson: z.string().optional(),
  notes: z.string().optional(),
});

const pricingSchema = z.object({
  basePrice: z.number().nonnegative(),
  subtotal: z.number().nonnegative(),
  addons: z
    .array(z.object({ name: z.string(), price: z.number(), quantity: z.number() }))
    .optional()
    .default([]),
  addonsTotal: z.number().optional().default(0),
  discount: z.number().optional().default(0),
  discountCode: z.string().optional(),
  tax: z.number().optional().default(0),
  commission: z.number().optional().default(0),
  total: z.number().nonnegative(),
  hostEarnings: z.number().optional(),
});

export const createReservationSchema = z.object({
  reservationNumber: z.string().optional(), // si no viene, lo generamos
  experience: z.string().min(1), // experienceId
  // Revendedor que trae la venta, por slug o id. Solo lo usa el catalogo
  // publico: en /reservations la empresa sale de la API key.
  reseller: z.string().min(1).optional(),
  // CRM-33. Token del enlace que el anfitrion le mando al cliente desde una
  // oportunidad. Sirve para colgar la reserva de esa oportunidad en vez de
  // dejarla suelta como una entrada mas del catalogo.
  solicitudToken: z.string().min(16).max(64).optional(),
  company: z.string().min(1).optional(), // si no viene, derivamos del experience
  client: clientSchema,
  clientType: clientTypeEnum.optional().default('GUEST'),
  user: z.string().min(1).optional(), // userId si es REGISTERED
  source: sourceEnum.optional().default('MANUAL'),
  reservationDate: z.string(),
  duration: z.number().int().positive().optional(),
  participants: z.number().int().positive(),
  status: statusEnum.optional().default('PENDING'),
  paymentStatus: paymentStatusEnum.optional().default('PENDING'),
  pricing: pricingSchema,
  paymentMethod: z.string().optional(),
  paymentDetails: z.record(z.string(), z.unknown()).optional(),
  location: z.string().min(1).optional(),
  isVirtual: z.boolean().optional().default(false),
  virtualDetails: z.record(z.string(), z.unknown()).optional(),
  specialRequirements: z.string().optional(),
  notes: z.string().optional(),
  // TR-42. El "programar de todas formas" cuando el anfitrion ya tiene algo a
  // esa hora en OTRA sede. Sobre la misma sede no sirve de nada: el sitio es
  // uno y no se parte en dos.
  permitirSolape: z.boolean().optional(),
});

export const updateReservationSchema = createReservationSchema.partial().extend({
  experience: z.never().optional(),
  company: z.never().optional(),
});

export const updateStatusSchema = z.object({ status: statusEnum });
export const updatePaymentStatusSchema = z.object({ paymentStatus: paymentStatusEnum });

/**
 * Cancelar una reserva, entera o en parte (TR-07).
 *
 * `participants` es cuanta gente se cae. Sin el, se cae la reserva completa;
 * con menos gente de la que hay, la reserva sigue viva con los que quedan y
 * los cupos de los que se fueron se liberan.
 *
 * `refundAmount` queda opcional porque quien cancela cambia la respuesta: si
 * cancela el anfitrion corresponde devolver lo cobrado y el servidor lo pone
 * por defecto; si cancela el comensal, depende de los terminos del anfitrion
 * y tiene que decirlo quien cancela.
 */
export const cancelSchema = z.object({
  cancelledBy: z.enum(['client', 'host', 'system']),
  reason: z.string().min(1),
  refundAmount: z.number().nonnegative().optional(),
  participants: z.number().int().positive().optional(),
});

export const rescheduleSchema = z.object({
  newDate: z.string(),
  reason: z.string().min(1),
  requestedBy: z.enum(['client', 'host']),
});

export const listReservationsQuerySchema = z.object({
  companyId: z.string().optional(),
  status: statusEnum.optional(),
  paymentStatus: paymentStatusEnum.optional(),
  experienceId: z.string().optional(),
  isVirtual: z.coerce.boolean().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['reservationDate', 'createdAt', 'total', 'participants']).optional().default('reservationDate'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const reservationIdParamsSchema = z.object({ id: z.string().min(1) });

/**
 * El codigo tal cual lo teclea el anfitrion.
 *
 * Laxo a proposito: llega con espacios, en minusculas o sin guion segun de
 * donde lo copie el cliente, y el servicio lo normaliza. Exigir el formato
 * exacto aqui seria mandar a alguien a reescribirlo delante de la fila.
 */
export const validarCodigoSchema = z.object({
  codigo: z.string().trim().min(4).max(40),
});

/**
 * Lo que llega al crear una reserva.
 *
 * `idempotencyKey` no esta en el esquema del cuerpo a proposito: viaja en
 * cabecera y la pone el controlador. Que no se pueda mandar en el body evita
 * que alguien la cuele en un formulario publico.
 */
export type CreateReservationInput = z.infer<typeof createReservationSchema> & {
  idempotencyKey?: string;
};
export type UpdateReservationInput = z.infer<typeof updateReservationSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type RescheduleInput = z.infer<typeof rescheduleSchema>;
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;
export type ValidarCodigoInput = z.infer<typeof validarCodigoSchema>;
