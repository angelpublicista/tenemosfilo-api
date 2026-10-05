// CRM-12/13. Las oportunidades que miran a una fecha, sobre el calendario.
//
// Una propuesta con fecha tentativa no aparta nada: el cliente todavia no ha
// dicho que si. Pero el anfitrion necesita verla al mirar ese dia, o vendera
// el mismo sabado dos veces sin saberlo, o lo dejara libre creyendo que no
// hay nada cuando tiene tres cotizaciones encima.
//
// De ahi que esto viva aparte de las reservas y no se mezcle con ellas: son
// dos cosas distintas y la pantalla tiene que poder distinguirlas.
import { prisma } from '../../config/prisma.js';
import { Forbidden } from '../../lib/errors.js';

/**
 * Que otro compromiso ya tomo el dia que mira esta oportunidad.
 *
 * Una pre-reserva SI bloquea (CRM-15), asi que en el momento en que una de
 * varias oportunidades sobre la misma fecha pasa a intencion de pago, las
 * demas se quedan sin sitio sin que nadie se lo diga. Esto es ese aviso.
 */
export interface EspacioTomado {
  fecha: string;
  experiencia: string | null;
  /** PENDING es "apartado a la espera de la decision"; CONFIRMED, ya vendido. */
  estado: string;
}

export interface OportunidadEnAgenda {
  id: string;
  nombre: string;
  etapa: string;
  tipoDeExperiencia: string | null;
  tipoDeComprador: string | null;
  contacto: string | null;
  /** La fecha que mira la propuesta. No bloquea nada. */
  fechaTentativa: string;
  hora: string | null;
  personas: number | null;
  valor: number;
  /** Cuando se pidio. Es lo que permite saber quien llego primero. */
  solicitadaEl: string;
  versionDeCotizacion: number;
  cotizacionEnviada: boolean;
}

/**
 * La fecha que mira una oportunidad: la de su cotizacion vigente.
 *
 * Misma regla que en `enRango` —enviada de version mas alta, y si ninguna se
 * envio, la ultima armada— porque un segundo sitio que decida cual manda
 * acabaria diciendo otra cosa.
 */
async function fechaQueMira(opportunityId: string): Promise<Date | null> {
  const q = await prisma.quote.findFirst({
    where: { opportunityId, eventDate: { not: null } },
    orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
    select: { eventDate: true },
  });
  return q?.eventDate ?? null;
}

export const agendaService = {
  /**
   * El aviso de que el dia ya esta tomado por otro.
   *
   * Solo informa: no cierra nada ni cambia la etapa. Quien lleva la venta
   * decide si ofrece otra fecha o la da por perdida, y eso no es algo que
   * deba decidir el sistema por su cuenta.
   *
   * Se avisa por dia, no por experiencia: una cotizacion puede mirar varias
   * experiencias a la vez, asi que cruzarlo por experiencia dejaria fuera
   * justo los casos dudosos. Se dice cual es el compromiso que esta encima
   * para que la persona juzgue si de verdad choca.
   */
  async espacioTomado(
    companyId: string | null | undefined,
    opportunityId: string,
  ): Promise<EspacioTomado | null> {
    if (!companyId) return null;

    // Si esta oportunidad ya tiene reserva viva, la que ocupa el dia es ella.
    const propia = await prisma.reservation.count({
      where: { opportunityId, status: { notIn: ['CANCELLED'] } },
    });
    if (propia > 0) return null;

    const fecha = await fechaQueMira(opportunityId);
    if (!fecha) return null;

    const inicio = new Date(fecha);
    inicio.setUTCHours(0, 0, 0, 0);
    const fin = new Date(inicio);
    fin.setUTCDate(fin.getUTCDate() + 1);

    const choque = await prisma.reservation.findFirst({
      where: {
        companyId,
        reservationDate: { gte: inicio, lt: fin },
        status: { in: ['PENDING', 'CONFIRMED'] },
        NOT: { opportunityId },
      },
      orderBy: { reservationDate: 'asc' },
      select: {
        status: true,
        reservationDate: true,
        experience: { select: { title: true } },
      },
    });
    if (!choque) return null;

    return {
      fecha: choque.reservationDate.toISOString(),
      experiencia: choque.experience?.title ?? null,
      estado: choque.status,
    };
  },

  /**
   * Las oportunidades abiertas con fecha tentativa dentro de un rango.
   *
   * La fecha sale de la cotizacion: es donde el cliente pone el dia que le
   * interesa. Si hay varias versiones manda la vigente —la enviada de version
   * mas alta—, y si ninguna se envio todavia, la ultima que se armo. La misma
   * regla que en el modulo de cotizaciones, y por el mismo motivo: un segundo
   * sitio que decida cual manda acabaria diciendo otra cosa.
   *
   * Quedan fuera las que ya tienen reserva o pre-reserva viva. Esas SI
   * bloquean y ya salen en el calendario como reservas; contarlas otra vez
   * aqui seria enseñar el mismo compromiso dos veces.
   */
  async enRango(
    companyId: string | null | undefined,
    desde: Date,
    hasta: Date,
  ): Promise<OportunidadEnAgenda[]> {
    if (!companyId) throw Forbidden('No tienes una company asociada');

    const cotizaciones = await prisma.quote.findMany({
      where: {
        companyId,
        eventDate: { gte: desde, lte: hasta },
        opportunityId: { not: null },
        opportunity: {
          status: 'OPEN',
          deletedAt: null,
          // Sin reservas vivas: las que las tienen ya ocupan el calendario.
          reservations: { none: { status: { notIn: ['CANCELLED'] } } },
        },
      },
      // Enviadas primero y por version descendente: asi la primera de cada
      // oportunidad es justo la vigente.
      orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
      select: {
        id: true,
        eventDate: true,
        eventTime: true,
        guests: true,
        version: true,
        sentAt: true,
        opportunity: {
          select: {
            id: true,
            name: true,
            stage: true,
            experienceKind: true,
            buyerKind: true,
            value: true,
            createdAt: true,
            contact: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    const porOportunidad = new Map<string, OportunidadEnAgenda>();
    for (const q of cotizaciones) {
      const o = q.opportunity;
      if (!o || porOportunidad.has(o.id)) continue;
      porOportunidad.set(o.id, {
        id: o.id,
        nombre: o.name,
        etapa: o.stage,
        tipoDeExperiencia: o.experienceKind,
        tipoDeComprador: o.buyerKind,
        contacto: [o.contact?.firstName, o.contact?.lastName].filter(Boolean).join(' ') || null,
        fechaTentativa: q.eventDate!.toISOString(),
        hora: q.eventTime,
        personas: q.guests,
        valor: Number(o.value),
        solicitadaEl: o.createdAt.toISOString(),
        versionDeCotizacion: q.version,
        cotizacionEnviada: Boolean(q.sentAt),
      });
    }

    // Por fecha, y dentro del mismo dia por orden de solicitud: quien pidio
    // primero sale primero. Es lo unico objetivo que hay para priorizar
    // mientras no se defina otra regla.
    return [...porOportunidad.values()].sort(
      (a, b) =>
        a.fechaTentativa.localeCompare(b.fechaTentativa) ||
        a.solicitadaEl.localeCompare(b.solicitadaEl),
    );
  },
};
