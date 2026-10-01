// El tramo final del embudo: apartar el espacio, cobrar y cerrar.
//
// Vive aparte del servicio de oportunidades porque no habla solo de
// oportunidades: crea reservas, mira pagos y toca seguimientos. Meterlo alli
// habria hecho de ese archivo un cajon.
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { retirarSeguimientos } from '../../lib/seguimientos.js';
import { enlaceService } from './opportunities.enlace.js';
import { conComisiones } from '../reservations/reservations.service.js';
import { pasarelaDe } from '../../lib/pasarela.js';
import { logger } from '../../lib/logger.js';

/**
 * Cuanto hay que haber cobrado para dar la venta por cerrada.
 *
 * Una abierta son cupos de un catalogo: se pagan enteros o el cupo sigue
 * libre para otro. Una privada es un evento a la medida, y el abono del 50%
 * es lo que compromete a las dos partes.
 */
const MINIMO_PARA_CONFIRMAR = { ABIERTA: 1, PRIVADA: 0.5 } as const;

/** El total de una reserva, que vive dentro del json de precios. */
function totalDe(pricing: unknown): number {
  const p = (pricing ?? {}) as { total?: unknown };
  return Number(p.total ?? 0);
}

async function oportunidadDe(id: string, companyId: string | null | undefined) {
  if (!companyId) throw Forbidden('No tienes una company asociada');
  const o = await prisma.opportunity.findFirst({
    where: { id, hostCompanyId: companyId, deletedAt: null },
    include: {
      contact: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
      reservations: { where: { status: { notIn: ['CANCELLED'] } } },
    },
  });
  if (!o) throw NotFound('Oportunidad no encontrada');
  return o;
}

export const ventaService = {
  /**
   * Medios de pago enviados: el espacio queda apartado.
   *
   * Solo en privadas. Una experiencia abierta son cupos de un catalogo: se
   * pagan y ya, y apartar un cupo a la espera de un pago que quiza no llegue
   * se lo quita a quien si iba a pagarlo.
   *
   * La pre-reserva bloquea desde el primer momento y no caduca sola. Eso es a
   * proposito y tiene un coste: un espacio apartado y olvidado es un espacio
   * perdido, y por eso nace tambien su seguimiento de cobro.
   */
  async crearPreReserva(
    id: string,
    companyId: string | null | undefined,
    _requesterId: string,
    input: {
      experienceId: string;
      locationId?: string;
      reservationDate: string;
      participants: number;
      total: number;
      duration?: number;
    },
  ) {
    const o = await oportunidadDe(id, companyId);

    if (o.experienceKind !== 'PRIVADA') {
      throw BadRequest(
        'La pre-reserva es solo para experiencias privadas. En una abierta, cobra el total y crea la reserva.',
      );
    }
    if (o.status !== 'OPEN') {
      throw BadRequest('Esta oportunidad ya está cerrada');
    }
    const yaHay = o.reservations.find((r) => r.status === 'PRE_RESERVED');
    if (yaHay) throw BadRequest('Esta oportunidad ya tiene una pre-reserva');

    const exp = await prisma.experience.findFirst({
      where: { id: input.experienceId, companyId: companyId!, deletedAt: null },
      select: { id: true, duration: true },
    });
    if (!exp) throw BadRequest('La experiencia no es de tu empresa');

    const cliente = {
      name: [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || 'Cliente',
      email: o.contact?.email ?? null,
      phone: o.contact?.phone ?? null,
    };

    // El reparto se calcula igual que en cualquier otra reserva. Sin esto la
    // venta del CRM entraba con un pricing de solo `total`, y al anfitrion no
    // se le devengaba nada: las dispersiones suman `hostEarnings`, que no
    // existia.
    const quienCobra = (await pasarelaDe(companyId!))?.quienCobra ?? 'PLATFORM';
    const pricing = await conComisiones(
      exp.id,
      { total: input.total } as never,
      false,
      quienCobra,
    );

    const ahora = new Date();
    const reserva = await prisma.reservation.create({
      data: {
        reservationNumber: `PRE-${Date.now().toString().slice(-6)}-${Math.random()
          .toString(36)
          .slice(2, 5)
          .toUpperCase()}`,
        companyId: companyId!,
        experienceId: exp.id,
        locationId: input.locationId ?? null,
        opportunityId: o.id,
        reservationDate: new Date(input.reservationDate),
        duration: input.duration ?? exp.duration ?? 60,
        participants: input.participants,
        status: 'PRE_RESERVED',
        paymentStatus: 'PENDING',
        client: cliente as Prisma.InputJsonValue,
        collectedBy: quienCobra,
        pricing,
        source: 'QUOTE',
      },
    });

    await prisma.opportunity.update({
      where: { id: o.id },
      data: { paymentInstructionsSentAt: ahora, stage: 'NEGOTIATION' },
    });

    // El seguimiento del cobro. Sin el, una pre-reserva olvidada deja el
    // espacio bloqueado indefinidamente y nadie se entera.
    try {
      await prisma.followup.upsert({
        where: { opportunityId_kind: { opportunityId: o.id, kind: 'PAGO_PENDIENTE' } },
        create: {
          opportunityId: o.id,
          kind: 'PAGO_PENDIENTE',
          dueAt: new Date(ahora.getTime() + 2 * 24 * 60 * 60 * 1000),
        },
        update: { dueAt: new Date(ahora.getTime() + 2 * 24 * 60 * 60 * 1000), status: 'PENDIENTE' },
      });
    } catch (err) {
      logger.error({ err, id: o.id }, 'no se pudo crear el seguimiento de cobro');
    }

    return reserva;
  },

  /**
   * Registrar lo cobrado. Devuelve si ya alcanza para confirmar.
   *
   * Se acumula en vez de sustituir: un evento se abona en dos o tres pagos y
   * guardar solo el ultimo daria por cobrado menos de lo que hay.
   */
  async registrarPago(
    id: string,
    companyId: string | null | undefined,
    monto: number,
  ) {
    const o = await oportunidadDe(id, companyId);
    // PENDING entra igual que PRE_RESERVED: la reserva de una abierta creada
    // desde la oportunidad nace pendiente, y sobre ella tambien se cobra.
    const reserva = o.reservations.find(
      (r) => r.status === 'PRE_RESERVED' || r.status === 'PENDING' || r.status === 'CONFIRMED',
    );
    if (!reserva) throw BadRequest('Esta oportunidad no tiene una reserva sobre la que registrar el pago');
    if (monto <= 0) throw BadRequest('El monto debe ser mayor que cero');

    const total = totalDe(reserva.pricing);
    const pagado = Number(reserva.paidAmount) + monto;

    await prisma.reservation.update({
      where: { id: reserva.id },
      data: {
        paidAmount: pagado,
        paymentStatus: pagado >= total && total > 0 ? 'PAID' : 'PARTIAL',
      },
    });

    return { pagado, total, faltante: Math.max(0, total - pagado) };
  },

  /**
   * Autorizar una condicion distinta al abono: una orden de compra, por
   * ejemplo.
   *
   * Solo el titular de la empresa. Autorizar esto es confirmar una venta sin
   * tener el dinero: si sale mal, el que pone el riesgo es el duenio del
   * negocio, no quien atendio el caso. Queda registrado quien lo autorizo,
   * porque sin rastro nadie responde por ello.
   */
  async autorizarCondicionDePago(
    id: string,
    companyId: string | null | undefined,
    requesterId: string,
    nota: string,
  ) {
    await oportunidadDe(id, companyId);
    const empresa = await prisma.company.findUnique({
      where: { id: companyId! },
      select: { ownerId: true },
    });
    if (empresa?.ownerId !== requesterId) {
      throw Forbidden(
        'Solo el titular de la empresa puede autorizar una condición de pago. ' +
          'Pídele que la autorice él, o registra el abono mínimo.',
      );
    }
    return prisma.opportunity.update({
      where: { id },
      data: { paymentConditionNote: nota, paymentConditionById: requesterId },
    });
  },

  /**
   * Confirmar la venta.
   *
   * Una abierta necesita el 100%; una privada, el 50% o una condicion
   * autorizada. La regla se comprueba aqui y no en la pantalla: es dinero, y
   * una comprobacion que vive solo en el navegador no es una comprobacion.
   */
  async confirmarVenta(id: string, companyId: string | null | undefined) {
    const o = await oportunidadDe(id, companyId);
    if (o.status !== 'OPEN') throw BadRequest('Esta oportunidad ya está cerrada');

    const reserva = o.reservations.find(
      (r) => r.status === 'PRE_RESERVED' || r.status === 'PENDING' || r.status === 'CONFIRMED',
    );
    if (!reserva) throw BadRequest('No hay una reserva que confirmar');

    const total = totalDe(reserva.pricing);
    const pagado = Number(reserva.paidAmount);
    const minimo = MINIMO_PARA_CONFIRMAR[o.experienceKind ?? 'PRIVADA'];
    const alcanza = total > 0 && pagado >= total * minimo;
    const conCondicion = Boolean(o.paymentConditionNote);

    if (!alcanza && !conCondicion) {
      const falta = Math.max(0, total * minimo - pagado);
      throw BadRequest(
        o.experienceKind === 'ABIERTA'
          ? `Una experiencia abierta se confirma con el pago completo. Faltan ${falta.toLocaleString('es-CO')}.`
          : `Una experiencia privada necesita al menos el 50%. Faltan ${falta.toLocaleString('es-CO')}, o autoriza una condición de pago.`,
      );
    }

    // CRM-31. Los datos de facturacion se congelan aqui, no antes.
    //
    // Al abrir el lead no se piden —pedir el NIT a quien acaba de escribir
    // por WhatsApp es perderlo—, asi que este es el momento en que existen.
    // Si nadie los reviso a mano, se toma lo que ya haya en la empresa o el
    // contacto: es mejor una factura con lo conocido que una sin nada.
    const facturacion = reserva.billingData
      ? null
      : (await enlaceService.facturacion(id, companyId)).datos;

    const [actualizada] = await prisma.$transaction([
      prisma.opportunity.update({
        where: { id },
        data: { stage: 'CLOSED_WON', status: 'WON', actualCloseDate: new Date() },
        include: { contact: true },
      }),
      // El espacio sigue bloqueado: pasa de apartado a confirmado.
      prisma.reservation.update({
        where: { id: reserva.id },
        data: {
          status: 'CONFIRMED',
          ...(facturacion
            ? { billingData: facturacion as unknown as Prisma.InputJsonValue }
            : {}),
        },
      }),
    ]);

    void retirarSeguimientos(id);
    return actualizada;
  },

  /**
   * Cerrar como perdida, con su motivo.
   *
   * Libera el espacio: la pre-reserva se cancela. Dejarla bloqueando seria
   * guardar una fecha para una venta que ya no existe.
   *
   * No toca al contacto ni a su historial: perder una oportunidad no convierte
   * a un cliente de años en un desconocido.
   */
  async perder(
    id: string,
    companyId: string | null | undefined,
    motivo: string,
    notas?: string,
  ) {
    const o = await oportunidadDe(id, companyId);
    if (o.status !== 'OPEN') throw BadRequest('Esta oportunidad ya está cerrada');

    const aLiberar = o.reservations
      .filter((r) => r.status === 'PRE_RESERVED' || r.status === 'PENDING')
      .map((r) => r.id);

    const [actualizada] = await prisma.$transaction([
      prisma.opportunity.update({
        where: { id },
        data: {
          stage: 'CLOSED_LOST',
          status: 'LOST',
          actualCloseDate: new Date(),
          lostReason: motivo,
          lostReasonNotes: notas ?? null,
        },
        include: { contact: true },
      }),
      ...(aLiberar.length
        ? [
            prisma.reservation.updateMany({
              where: { id: { in: aLiberar } },
              data: { status: 'CANCELLED' },
            }),
          ]
        : []),
    ]);

    void retirarSeguimientos(id);
    return actualizada;
  },
};
