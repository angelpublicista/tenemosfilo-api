// Pagos de experiencias a traves de Wompi.
//
// El cobro lo procesa FILO: el cliente paga en la pasarela y despues se
// dispersa a anfitriones y revendedores (ver modulo payouts).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { pasarelaDeLaReserva, pasarelaDelAnfitrion } from '../../lib/pasarela.js';
import { firmaValida, leerPago as leerPagoDeMercadoPago } from '../../lib/mercadopago.js';
import {
  aEstadoDePago as aEstadoDePagoDeBold,
  firmaValida as firmaDeBoldValida,
} from '../../lib/bold.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { anotarCobroSinReserva } from '../../lib/cobro-sin-reserva.js';
import { prisma } from '../../config/prisma.js';
import { aEstadoDePago, webhookValido } from '../../lib/wompi.js';
import { avisarCambioDeEstado, avisarPago, cargarDatosDeReserva } from '../../lib/notify.js';
import { construirCheckout } from './payments.service.js';
import { cerrarVentaPorPagoEnLinea } from '../opportunities/opportunities.enlace.js';

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

// ─── TR-44. Cobros sin reserva ────────────────────────────────────────────
//
// La bandeja de anomalias: cobros que llegaron y no tenian a que colgarse.
// Es del equipo de Tenemos Filo porque lo que hay que hacer con uno —devolver
// el dinero, buscar a quien pago— se hace desde la pasarela, no desde el
// panel de un anfitrion.

paymentsRouter.get(
  '/cobros-sin-reserva',
  requireAuth,
  requireHumanAuth,
  requireRole('ADMIN'),
  validate(
    z.object({
      resueltos: z.enum(['true', 'false']).optional(),
      limit: z.coerce.number().int().positive().max(200).default(50),
    }),
    'query',
  ),
  async (req: Request, res: Response) => {
    const { resueltos, limit } = req.query as unknown as {
      resueltos?: 'true' | 'false';
      limit: number;
    };
    const items = await prisma.orphanPayment.findMany({
      where: resueltos === undefined ? {} : { resolved: resueltos === 'true' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const pendientes = await prisma.orphanPayment.count({ where: { resolved: false } });
    res.json({ data: items, meta: { pendientes } });
  },
);

paymentsRouter.post(
  '/cobros-sin-reserva/:id/resuelto',
  requireAuth,
  requireHumanAuth,
  requireRole('ADMIN'),
  validate(z.object({ id: z.string().min(1) }), 'params'),
  validate(z.object({ notas: z.string().max(2000).optional() })),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const { notas } = req.body as { notas?: string };
    const existe = await prisma.orphanPayment.findUnique({ where: { id } });
    if (!existe) throw NotFound('Ese cobro no existe');
    // Las notas son lo unico que explica que se hizo con el dinero, asi que se
    // conservan si ya habia: se añaden, no se pisan.
    const juntas = notas?.trim()
      ? [existe.notes, notas.trim()].filter(Boolean).join('\n')
      : existe.notes;
    const actualizado = await prisma.orphanPayment.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date(), notes: juntas },
    });
    res.json({ data: actualizado });
  },
);

paymentsRouter.post('/wompi/webhook', async (req: Request, res: Response) => {
  const evento = req.body as Record<string, unknown>;
  const transaccion = (evento.data as { transaction?: Record<string, unknown> } | undefined)
    ?.transaction;
  const referencia = transaccion?.reference;
  const estado = transaccion?.status;

  if (typeof referencia !== 'string' || typeof estado !== 'string') {
    return res.status(200).json({ received: true });
  }

  // La referencia que enviamos al checkout es el numero de reserva.
  //
  // Se lee ANTES de validar la firma, y a proposito: hay un secreto de eventos
  // por pasarela —la de la plataforma y la de cada anfitrion que cobre por su
  // cuenta—, y sin saber de que reserva habla el evento no se sabe contra cual
  // validarlo. Leer la referencia no cambia nada; nada se escribe hasta que la
  // firma cuadra.
  const reserva = await prisma.reservation.findUnique({
    where: { reservationNumber: referencia },
    select: {
      id: true,
      paymentStatus: true,
      paymentDetails: true,
      pricing: true,
      opportunityId: true,
      companyId: true,
      collectedBy: true,
    },
  });
  if (!reserva) {
    // TR-44. Ningun cobro sin reserva, y cumplirlo es que no pase
    // desapercibido: la reserva se pudo borrar entre el pago y este evento.
    // Se apunta para que alguien devuelva ese dinero o encuentre a quien pago.
    const centavosHuerfano = transaccion?.amount_in_cents;
    await anotarCobroSinReserva({
      gateway: 'WOMPI',
      reference: referencia,
      transactionId: typeof transaccion?.id === 'string' ? transaccion.id : null,
      amount:
        typeof centavosHuerfano === 'number' && centavosHuerfano > 0
          ? centavosHuerfano / 100
          : null,
      currency: typeof transaccion?.currency === 'string' ? transaccion.currency : null,
      gatewayStatus: typeof estado === 'string' ? estado : null,
      event: evento,
    });
    logger.warn({ referencia }, 'Webhook de Wompi para una reserva desconocida');
    return res.status(200).json({ received: true });
  }

  const pasarela = await pasarelaDeLaReserva(reserva.companyId, reserva.collectedBy);
  if (!pasarela?.eventsSecret) {
    logger.error(
      { referencia, quienCobra: reserva.collectedBy },
      'Webhook de Wompi sin secreto de eventos para esa pasarela',
    );
    // 200 a proposito: si respondemos error, Wompi reintentara sin fin algo
    // que no vamos a poder procesar hasta que se configure.
    return res.status(200).json({ received: true });
  }

  if (!webhookValido(evento, pasarela.eventsSecret)) {
    logger.warn({ evento: evento?.event }, 'Webhook de Wompi con firma invalida: descartado');
    return res.status(401).json({ error: { code: 'INVALID_SIGNATURE' } });
  }

  const nuevoEstado = aEstadoDePago(estado);
  const idTransaccion = typeof transaccion?.id === 'string' ? transaccion.id : null;
  const idQuePago =
    (reserva.paymentDetails as { transactionId?: string | null } | null)?.transactionId ?? null;

  // Un cobro hecho no se deshace por un evento de OTRA transaccion.
  //
  // Wompi reintenta las entregas que fallan, asi que los eventos pueden
  // llegar desordenados. El caso real: al cliente le rechazan la tarjeta,
  // reintenta y el segundo cobro entra; si la entrega del rechazo se
  // reintenta despues, aterriza sobre una reserva ya pagada. Antes se
  // aplicaba tal cual y la dejaba confirmada pero marcada como no pagada,
  // con el dinero cobrado.
  //
  // La anulacion de la transaccion que SI pago —misma id, estado VOIDED—
  // es otra cosa y tiene que entrar: ahi el dinero se devuelve de verdad.
  if (reserva.paymentStatus === 'PAID' && nuevoEstado !== 'PAID' && idTransaccion !== idQuePago) {
    logger.warn(
      { referencia, estado, idTransaccion, idQuePago },
      'Evento de Wompi descartado: la reserva ya esta pagada por otra transaccion',
    );
    return res.status(200).json({ received: true });
  }

  // Cuanto entro de verdad.
  //
  // `paymentStatus` dice si esta pagada, pero el CRM necesita el monto: es lo
  // que compara contra el minimo para dejar confirmar una venta. Sin esto una
  // reserva cobrada entera por la pasarela seguia figurando con cero pagado y
  // la oportunidad no se podia cerrar.
  //
  // Wompi manda centavos. Si el evento no lo trae, se cae al total de la
  // reserva, que es lo que se le cobro.
  const centavos = transaccion?.amount_in_cents;
  const cobrado =
    typeof centavos === 'number' && centavos > 0
      ? centavos / 100
      : Number((reserva.pricing as { total?: unknown } | null)?.total ?? 0);

  await prisma.reservation.update({
    where: { id: reserva.id },
    data: {
      paymentStatus: nuevoEstado,
      paymentMethod: 'WOMPI',
      ...(nuevoEstado === 'PAID' ? { paidAmount: cobrado } : {}),
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
    // Si la reserva venia del enlace de una oportunidad, el pago cierra la
    // venta: no hay nada mas que decidir.
    if (reserva.opportunityId) void cerrarVentaPorPagoEnLinea(reserva.opportunityId);
    void (async () => {
      const datos = await cargarDatosDeReserva(reserva.id);
      if (!datos) return;
      await avisarPago(datos);
      await avisarCambioDeEstado(datos, 'CONFIRMED');
    })();
  }

  res.status(200).json({ received: true });
});

/**
 * Webhook de Mercado Pago.
 *
 * La URL lleva la empresa dentro porque cada anfitrion cobra con su propia
 * cuenta: sin saber de quien es el cobro no hay token con el que preguntarle
 * a Mercado Pago que paso. Se la damos nosotros al crear cada preferencia, asi
 * que el anfitrion no tiene que configurar nada en su panel.
 *
 * Su notificacion solo trae un id. El estado NO se lee de aqui: se relee el
 * pago contra su API con el token del anfitrion. Eso hace que una notificacion
 * falsificada no pueda marcar nada como pagado — lo peor que consigue es que
 * preguntemos por un pago que no existe.
 */
paymentsRouter.post(
  '/mercadopago/webhook/:companyId',
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  async (req: Request, res: Response) => {
    const { companyId } = req.params as { companyId: string };
    const cuerpo = (req.body ?? {}) as {
      type?: string;
      topic?: string;
      action?: string;
      data?: { id?: string | number };
      id?: string | number;
    };

    // Manda varios tipos de evento; solo los de pago dicen algo del cobro.
    const tipo = cuerpo.type ?? cuerpo.topic;
    if (tipo && tipo !== 'payment') return res.status(200).json({ received: true });

    const paymentId = String(cuerpo.data?.id ?? cuerpo.id ?? req.query.id ?? '');
    if (!paymentId) return res.status(200).json({ received: true });

    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        paymentProvider: true,
        paymentGatewayEnabled: true,
        paymentEnvironment: true,
        gatewayPublicKey: true,
        gatewayPrivateKey: true,
        gatewayIntegritySecret: true,
        gatewayEventsSecret: true,
      },
    });
    const pasarela = pasarelaDelAnfitrion(empresa);
    if (!pasarela || pasarela.proveedor !== 'MERCADO_PAGO' || !pasarela.privateKey) {
      logger.error({ companyId }, 'Webhook de Mercado Pago para una empresa sin esa pasarela');
      // 200 a proposito: reintentarlo no va a arreglar una configuracion.
      return res.status(200).json({ received: true });
    }

    // Solo si el anfitrion guardo el secreto. No es lo que impide que nos
    // mientan —para eso se relee el pago— sino lo que evita que un tercero
    // nos haga consultar su API a voluntad.
    if (pasarela.eventsSecret) {
      const valida = firmaValida({
        xSignature: req.headers['x-signature'] as string | undefined,
        xRequestId: req.headers['x-request-id'] as string | undefined,
        dataId: paymentId,
        secreto: pasarela.eventsSecret,
      });
      if (!valida) {
        logger.warn({ companyId, paymentId }, 'Webhook de Mercado Pago con firma invalida');
        return res.status(401).json({ error: { code: 'INVALID_SIGNATURE' } });
      }
    }

    const pago = await leerPagoDeMercadoPago(pasarela.privateKey, paymentId);
    if (!pago?.referencia) {
      logger.warn({ companyId, paymentId }, 'Mercado Pago no devolvio el pago o venia sin referencia');
      return res.status(200).json({ received: true });
    }

    const reserva = await prisma.reservation.findUnique({
      where: { reservationNumber: pago.referencia },
      select: {
        id: true,
        companyId: true,
        paymentStatus: true,
        paymentDetails: true,
        pricing: true,
        opportunityId: true,
      },
    });
    // La reserva tiene que ser de la empresa cuyo token acabamos de usar. Sin
    // esta comprobacion, un anfitrion podria mover el estado de la reserva de
    // otro mandando su propio id de pago a su propia URL.
    if (!reserva || reserva.companyId !== companyId) {
      // TR-44, igual que en Wompi. Si la reserva es de OTRA empresa no es un
      // huerfano —existe y tiene dueño— sino un intento de tocar lo ajeno, y
      // ese se descarta sin apuntar nada.
      if (!reserva) {
        await anotarCobroSinReserva({
          gateway: 'MERCADO_PAGO',
          reference: pago.referencia,
          transactionId: pago.id ?? null,
          amount: pago.monto ?? null,
          currency: null,
          gatewayStatus: pago.estadoCrudo ?? null,
          companyId,
          event: pago as unknown,
        });
      }
      logger.warn({ companyId, referencia: pago.referencia }, 'Pago de Mercado Pago para una reserva ajena o desconocida');
      return res.status(200).json({ received: true });
    }

    const idQuePago =
      (reserva.paymentDetails as { transactionId?: string | null } | null)?.transactionId ?? null;
    // Un cobro hecho no se deshace por un evento de OTRO pago. Las
    // notificaciones se reintentan y llegan desordenadas.
    if (reserva.paymentStatus === 'PAID' && pago.estado !== 'PAID' && idQuePago !== pago.id) {
      logger.warn(
        { referencia: pago.referencia, estado: pago.estadoCrudo },
        'Evento de Mercado Pago descartado: la reserva ya esta pagada por otro pago',
      );
      return res.status(200).json({ received: true });
    }

    const cobrado =
      pago.monto > 0 ? pago.monto : Number((reserva.pricing as { total?: unknown } | null)?.total ?? 0);

    await prisma.reservation.update({
      where: { id: reserva.id },
      data: {
        paymentStatus: pago.estado,
        paymentMethod: 'MERCADO_PAGO',
        // Una devolucion deja la reserva sin dinero cobrado: dejar el monto
        // puesto le diria al CRM que la venta sigue pagada.
        ...(pago.estado === 'PAID' ? { paidAmount: cobrado } : {}),
        ...(pago.estado === 'REFUNDED' ? { paidAmount: 0 } : {}),
        paymentDetails: {
          provider: 'mercadopago',
          transactionId: pago.id,
          status: pago.estadoCrudo,
          raw: pago.crudo as object,
        },
        ...(pago.estado === 'PAID' ? { status: 'CONFIRMED' as const } : {}),
      },
    });

    logger.info(
      { referencia: pago.referencia, estado: pago.estadoCrudo },
      'Pago de Mercado Pago procesado',
    );

    if (pago.estado === 'PAID' && reserva.paymentStatus !== 'PAID') {
      if (reserva.opportunityId) void cerrarVentaPorPagoEnLinea(reserva.opportunityId);
      void (async () => {
        const datos = await cargarDatosDeReserva(reserva.id);
        if (!datos) return;
        await avisarPago(datos);
        await avisarCambioDeEstado(datos, 'CONFIRMED');
      })();
    }

    res.status(200).json({ received: true });
  },
);

/**
 * Webhook de Bold.
 *
 * La URL lleva la empresa dentro por lo mismo que la de Mercado Pago: cada
 * anfitrion cobra con su cuenta y hay que saber con que llave validar. Pero
 * aqui no se la podemos dar nosotros en cada cobro: Bold solo admite
 * configurarla en su panel, asi que el anfitrion la pega a mano.
 *
 * Eso tiene una consecuencia: es el webhook de TODA su cuenta. Llegan tambien
 * las ventas de su datafono y los links que cree por su lado. Lo que no trae
 * un numero de reserva nuestro se ignora sin apuntarlo como anomalia; si no,
 * cada cafe cobrado en el local acabaria en la bandeja de cobros sin reserva.
 *
 * El estado viene dentro del evento, asi que la firma es obligatoria: es lo
 * unico que impide que alguien marque como pagada una reserva sin pagar.
 */
paymentsRouter.post(
  '/bold/webhook/:companyId',
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  async (req: Request, res: Response) => {
    const { companyId } = req.params as { companyId: string };
    const evento = (req.body ?? {}) as {
      type?: string;
      data?: {
        payment_id?: string;
        amount?: { total?: number; currency?: string };
        metadata?: { reference?: string | null };
      };
    };

    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        paymentProvider: true,
        paymentGatewayEnabled: true,
        paymentEnvironment: true,
        gatewayPublicKey: true,
        gatewayPrivateKey: true,
        gatewayIntegritySecret: true,
        gatewayEventsSecret: true,
      },
    });
    const pasarela = pasarelaDelAnfitrion(empresa);
    if (!pasarela || pasarela.proveedor !== 'BOLD' || !pasarela.privateKey) {
      logger.error({ companyId }, 'Webhook de Bold para una empresa sin esa pasarela');
      // 200 a proposito: reintentarlo no va a arreglar una configuracion.
      return res.status(200).json({ received: true });
    }

    const valida = firmaDeBoldValida({
      firma: req.headers['x-bold-signature'] as string | undefined,
      cuerpoCrudo: (req as Request & { rawBody?: Buffer }).rawBody,
      llaveSecreta: pasarela.privateKey,
      entorno: pasarela.entorno,
    });
    if (!valida) {
      logger.warn({ companyId }, 'Webhook de Bold con firma invalida');
      return res.status(401).json({ error: { code: 'INVALID_SIGNATURE' } });
    }

    const nuevoEstado = aEstadoDePagoDeBold(evento.type ?? '');
    const referencia = evento.data?.metadata?.reference ?? null;
    const idDePago = evento.data?.payment_id ?? null;
    // Ventas del datafono, links hechos a mano, tipos de evento que no nos
    // dicen nada: no son nuestros.
    if (!nuevoEstado || !referencia || !referencia.startsWith('RES-')) {
      return res.status(200).json({ received: true });
    }

    const monto = Number(evento.data?.amount?.total ?? 0);

    const reserva = await prisma.reservation.findUnique({
      where: { reservationNumber: referencia },
      select: {
        id: true,
        companyId: true,
        paymentStatus: true,
        paymentDetails: true,
        pricing: true,
        opportunityId: true,
      },
    });
    // La reserva tiene que ser de la empresa cuya llave acaba de validar la
    // firma. Sin esto, un anfitrion podria marcar como pagada la reserva de
    // otro firmando el evento con su propia llave.
    if (!reserva || reserva.companyId !== companyId) {
      // TR-44: lleva un numero de reserva nuestro y la reserva ya no existe.
      // Si es de OTRA empresa no es un huerfano y se descarta sin apuntar.
      if (!reserva) {
        await anotarCobroSinReserva({
          gateway: 'BOLD',
          reference: referencia,
          transactionId: idDePago,
          amount: monto > 0 ? monto : null,
          currency: evento.data?.amount?.currency ?? null,
          gatewayStatus: evento.type ?? null,
          companyId,
          event: evento as unknown,
        });
      }
      logger.warn({ companyId, referencia }, 'Pago de Bold para una reserva ajena o desconocida');
      return res.status(200).json({ received: true });
    }

    const idQuePago =
      (reserva.paymentDetails as { transactionId?: string | null } | null)?.transactionId ?? null;
    // Un cobro hecho no se deshace por un evento de OTRO pago. Bold reintenta
    // hasta 24 horas despues y los eventos llegan desordenados.
    if (reserva.paymentStatus === 'PAID' && nuevoEstado !== 'PAID' && idQuePago !== idDePago) {
      logger.warn(
        { referencia, tipo: evento.type },
        'Evento de Bold descartado: la reserva ya esta pagada por otro pago',
      );
      return res.status(200).json({ received: true });
    }

    const cobrado =
      monto > 0 ? monto : Number((reserva.pricing as { total?: unknown } | null)?.total ?? 0);

    await prisma.reservation.update({
      where: { id: reserva.id },
      data: {
        paymentStatus: nuevoEstado,
        paymentMethod: 'BOLD',
        ...(nuevoEstado === 'PAID' ? { paidAmount: cobrado } : {}),
        ...(nuevoEstado === 'REFUNDED' ? { paidAmount: 0 } : {}),
        paymentDetails: {
          provider: 'bold',
          transactionId: idDePago,
          status: evento.type ?? null,
          raw: (evento.data ?? {}) as object,
        },
        ...(nuevoEstado === 'PAID' ? { status: 'CONFIRMED' as const } : {}),
      },
    });

    logger.info({ referencia, tipo: evento.type }, 'Pago de Bold procesado');

    if (nuevoEstado === 'PAID' && reserva.paymentStatus !== 'PAID') {
      if (reserva.opportunityId) void cerrarVentaPorPagoEnLinea(reserva.opportunityId);
      void (async () => {
        const datos = await cargarDatosDeReserva(reserva.id);
        if (!datos) return;
        await avisarPago(datos);
        await avisarCambioDeEstado(datos, 'CONFIRMED');
      })();
    }

    res.status(200).json({ received: true });
  },
);

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
