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
/**
 * Cuanto hay que haber cobrado para poder confirmar.
 *
 * Una abierta solo queda confirmada con el pago completo: son cupos de un
 * catalogo y no se apartan a credito.
 *
 * Una privada no tiene minimo. El 50% que habia aqui era una regla de la
 * agencia, no del producto: cada anfitrion acuerda con su cliente si cobra un
 * abono, una orden de compra o nada, y eso se registra en vez de imponerse
 * (TR-02 del documento transversal).
 */
const MINIMO_PARA_CONFIRMAR = { ABIERTA: 1, PRIVADA: 0 } as const;

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

/**
 * Cuantas opciones distintas se le pusieron sobre la mesa al cliente (TR-15).
 *
 * Primero las de la propia oportunidad; si no tiene, las de su cotizacion
 * vigente, que es de donde salen cuando se armo desde ahi. Misma regla de
 * vigencia que en la agenda: enviada de version mas alta, y si ninguna se
 * envio, la ultima armada.
 */
async function opcionesDe(opportunityId: string): Promise<number> {
  const propias = await prisma.opportunityExperience.count({ where: { opportunityId } });
  if (propias > 0) return propias;

  const q = await prisma.quote.findFirst({
    where: { opportunityId },
    orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
    select: { experiences: { select: { id: true } } },
  });
  return q?.experiences.length ?? 0;
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
    const yaHay = o.reservations.find((r) => r.status === 'PENDING');
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
      // Una privada se negocia y se cobra fuera de FILO: no genera fee.
      'QUOTE',
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
        // TR-01. Pendiente, que es lo que siempre fue: comprometida, sin
        // cobrar y bloqueando el recurso.
        status: 'PENDING',
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
    // Pendiente o confirmada: la reserva de una abierta creada
    // desde la oportunidad nace pendiente, y sobre ella tambien se cobra.
    const reserva = o.reservations.find(
      (r) => r.status === 'PENDING' || r.status === 'CONFIRMED',
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
   * Una abierta necesita el pago completo, y eso se comprueba aqui y no en la
   * pantalla: es dinero, y una comprobacion que vive solo en el navegador no
   * es una comprobacion.
   *
   * Una privada la confirma el anfitrion cuando el lo decide. No hay minimo
   * que imponer: lo que acordo con su cliente —un abono, una orden de compra,
   * nada— es asunto suyo y se registra en `paymentConditionNote`.
   */
  async confirmarVenta(id: string, companyId: string | null | undefined) {
    const o = await oportunidadDe(id, companyId);
    if (o.status !== 'OPEN') throw BadRequest('Esta oportunidad ya está cerrada');

    const reserva = o.reservations.find(
      (r) => r.status === 'PENDING' || r.status === 'CONFIRMED',
    );
    if (!reserva) throw BadRequest('No hay una reserva que confirmar');

    const total = totalDe(reserva.pricing);
    const pagado = Number(reserva.paidAmount);
    const minimo = MINIMO_PARA_CONFIRMAR[o.experienceKind ?? 'PRIVADA'];
    const alcanza = minimo === 0 || (total > 0 && pagado >= total * minimo);
    const conCondicion = Boolean(o.paymentConditionNote);

    if (!alcanza && !conCondicion) {
      const falta = Math.max(0, total * minimo - pagado);
      throw BadRequest(
        `Una experiencia abierta se confirma con el pago completo. Faltan ${falta.toLocaleString('es-CO')}.`,
      );
    }

    // TR-15. Con varias opciones sobre la mesa, confirmar la primera reserva
    // no cierra la venta. El cliente puede haber dicho que si a la cena del
    // sabado y seguir pensando el almuerzo del domingo; darla por ganada
    // ahora borra del embudo lo que todavia se esta vendiendo, y nadie
    // vuelve a llamar. Quien lleva la venta la cierra cuando lo sepa.
    const opciones = await opcionesDe(id);
    const variasOpciones = o.experienceKind === 'PRIVADA' && opciones > 1;

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
        data: variasOpciones
          ? // Sigue abierta y en la etapa en la que se decide: hay una venta
            // hecha y otras en el aire.
            { stage: 'APPROVAL' }
          : { stage: 'CLOSED_WON', status: 'WON', actualCloseDate: new Date() },
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

    // Los seguimientos solo se retiran si se cerro: mientras siga abierta hay
    // algo que perseguir, y quitarselos es perder de vista lo que falta.
    if (!variasOpciones) void retirarSeguimientos(id);
    return { ...actualizada, opcionesPendientes: variasOpciones ? opciones - 1 : 0 };
  },

  /**
   * Cerrar como ganada a mano (TR-15).
   *
   * Hace falta porque con varias opciones confirmar una reserva ya no cierra
   * la oportunidad: alguien tiene que decir "esto ya esta". Exige que haya al
   * menos una reserva confirmada, porque "ganada" sin nada vendido no
   * significa nada y descuadraria el embudo.
   */
  async cerrarGanada(id: string, companyId: string | null | undefined) {
    const o = await oportunidadDe(id, companyId);
    if (o.status !== 'OPEN') throw BadRequest('Esta oportunidad ya está cerrada');

    const confirmadas = o.reservations.filter((r) => r.status === 'CONFIRMED').length;
    if (confirmadas === 0) {
      throw BadRequest(
        'No hay ninguna reserva confirmada. Confirma la venta antes de cerrar la oportunidad.',
      );
    }

    const actualizada = await prisma.opportunity.update({
      where: { id },
      data: { stage: 'CLOSED_WON', status: 'WON', actualCloseDate: new Date() },
      include: { contact: true },
    });

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
      .filter((r) => r.status === 'PENDING')
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
