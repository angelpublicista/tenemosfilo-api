// Pagos de experiencias a traves de Wompi.
//
// El cobro lo procesa FILO: el cliente paga en la pasarela y despues se
// dispersa a anfitriones y revendedores (ver modulo payouts).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getPlatformSettings } from '../../lib/commissions.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../config/prisma.js';
import { aEstadoDePago, webhookValido } from '../../lib/wompi.js';
import { avisarCambioDeEstado, avisarPago, cargarDatosDeReserva } from '../../lib/notify.js';
import { construirCheckout } from './payments.service.js';

export const paymentsRouter = Router();

const checkoutSchema = z.object({
  reservationId: z.string().min(1),
  /** A donde vuelve el cliente tras pagar. */
  redirectUrl: z.string().url().optional(),
});

// ─── Webhook (publico, sin auth) ────────────────────────────────────────────
//
// Va ANTES de requireAuth: lo llama Wompi, no un usuario. Su autenticidad se
// comprueba con la firma del evento, no con un token.

paymentsRouter.post('/wompi/webhook', async (req: Request, res: Response) => {
  const ajustes = await getPlatformSettings();
  if (!ajustes.wompiEventsSecret) {
    logger.error('Webhook de Wompi recibido sin secreto de eventos configurado');
    // 200 a proposito: si respondemos error, Wompi reintentara sin fin algo
    // que no vamos a poder procesar hasta que se configure.
    return res.status(200).json({ received: true });
  }

  const evento = req.body as Record<string, unknown>;
  if (!webhookValido(evento, ajustes.wompiEventsSecret)) {
    logger.warn({ evento: evento?.event }, 'Webhook de Wompi con firma invalida: descartado');
    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE' } });
  }

  const transaccion = (evento.data as { transaction?: Record<string, unknown> } | undefined)
    ?.transaction;
  const referencia = transaccion?.reference;
  const estado = transaccion?.status;

  if (typeof referencia !== 'string' || typeof estado !== 'string') {
    return res.status(200).json({ received: true });
  }

  // La referencia que enviamos al checkout es el numero de reserva.
  const reserva = await prisma.reservation.findUnique({
    where: { reservationNumber: referencia },
    select: { id: true, paymentStatus: true },
  });
  if (!reserva) {
    logger.warn({ referencia }, 'Webhook de Wompi para una reserva desconocida');
    return res.status(200).json({ received: true });
  }

  const nuevoEstado = aEstadoDePago(estado);
  await prisma.reservation.update({
    where: { id: reserva.id },
    data: {
      paymentStatus: nuevoEstado,
      paymentMethod: 'WOMPI',
      paymentDetails: {
        provider: 'wompi',
        transactionId: transaccion?.id ?? null,
        status: estado,
        // Guardamos el evento crudo: si algo no cuadra, es la unica fuente
        // de verdad de lo que dijo la pasarela.
        raw: transaccion as object,
      },
      // Un pago aprobado confirma la reserva; el resto de estados no la tocan.
      ...(nuevoEstado === 'PAID' ? { status: 'CONFIRMED' as const } : {}),
    },
  });

  logger.info({ referencia, estado, nuevoEstado }, 'Pago de Wompi procesado');

  // Avisar de un pago en linea.
  //
  // Es el camino por el que entra la mayoria de los pagos reales, y hasta
  // ahora no notificaba nada: el comensal pagaba y no recibia ni el
  // comprobante ni la confirmacion. Solo si el estado CAMBIO a pagado, para
  // que un reintento del webhook —Wompi los manda— no duplique los correos.
  if (nuevoEstado === 'PAID' && reserva.paymentStatus !== 'PAID') {
    void (async () => {
      const datos = await cargarDatosDeReserva(reserva.id);
      if (!datos) return;
      await avisarPago(datos);
      await avisarCambioDeEstado(datos, 'CONFIRMED');
    })();
  }

  res.status(200).json({ received: true });
});

// ─── Resto: requiere sesion ─────────────────────────────────────────────────

paymentsRouter.use(requireAuth);

/**
 * Datos firmados para abrir el checkout de una reserva.
 *
 * La firma se calcula aqui porque necesita el secreto de integridad, que no
 * puede salir del servidor.
 */
paymentsRouter.post('/checkout', validate(checkoutSchema), async (req: Request, res: Response) => {
  const { reservationId, redirectUrl } = req.body as z.infer<typeof checkoutSchema>;

  const reserva = await prisma.reservation.findUnique({
    where: { id: reservationId },
    select: { reservationNumber: true, paymentStatus: true },
  });
  if (!reserva) throw NotFound('Reserva no encontrada');
  if (reserva.paymentStatus === 'PAID') throw BadRequest('Esta reserva ya esta pagada');

  // Misma construccion que usa el alta publica: una sola implementacion de
  // la firma, que es donde un error se traduce en pagos que no entran.
  const datos = await construirCheckout(reserva.reservationNumber, { redirectUrl });
  if (!datos) throw BadRequest('La pasarela de pagos no esta configurada o la reserva no es cobrable');

  return res.json({ data: datos });
});
