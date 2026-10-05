import { prisma } from '../../config/prisma.js';
import { nuevoTokenDeCalificacion } from '../../lib/calificacion.js';
import { cargarDatosDeReserva, pedirCalificacion } from '../../lib/notify.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { retirarPropuestasPosteriores } from '../../lib/seguimientos.js';

/**
 * El panel del CRM: que necesita atencion hoy.
 *
 * El CRM es una herramienta de venta, no un archivo. Al entrar, lo primero no
 * deberia ser una lista de todo lo que existe sino lo que hay que hacer: a
 * quien falta contestarle, que propuesta lleva dias sin respuesta, que
 * experiencia termino y nadie ha calificado.
 */

const DIA = 24 * 60 * 60 * 1000;

export const crmPanelService = {
  /** Lo que requiere accion, agrupado por motivo. */
  async pendientes(companyId: string | null | undefined) {
    if (!companyId) throw Forbidden('No tienes una company asociada');
    const ahora = new Date();

    const [seguimientos, prereservas, porCalificar] = await Promise.all([
      // Seguimientos vencidos o de hoy. Los de mañana no son pendientes: son
      // futuro, y meterlos aqui convierte la lista en ruido.
      prisma.followup.findMany({
        where: {
          status: 'PENDIENTE',
          dueAt: { lte: new Date(ahora.getTime() + DIA) },
          opportunity: { hostCompanyId: companyId, deletedAt: null },
        },
        orderBy: { dueAt: 'asc' },
        take: 50,
        include: {
          opportunity: {
            select: {
              id: true,
              name: true,
              stage: true,
              experienceKind: true,
              contact: { select: { firstName: true, lastName: true, phone: true, email: true } },
            },
          },
        },
      }),

      // Propuestas enviadas que llevan mas de tres dias sin moverse. No es un
      // seguimiento creado: es una lectura del embudo, y por eso se calcula.
      prisma.opportunity.findMany({
        where: {
          hostCompanyId: companyId,
          deletedAt: null,
          stage: 'PROPOSAL',
          status: 'OPEN',
          proposalSentAt: { lte: new Date(ahora.getTime() - 3 * DIA) },
        },
        orderBy: { proposalSentAt: 'asc' },
        take: 20,
        select: {
          id: true,
          name: true,
          proposalSentAt: true,
          value: true,
          contact: { select: { firstName: true, lastName: true } },
        },
      }),

      // CRM-26: experiencias que ya pasaron y siguen sin cerrarse. Sin modelo
      // de reseñas todavia, "pendiente de calificar" es esto: ocurrio y nadie
      // la ha dado por terminada.
      prisma.reservation.findMany({
        where: {
          companyId,
          status: 'CONFIRMED',
          reservationDate: { lt: ahora },
        },
        orderBy: { reservationDate: 'desc' },
        take: 20,
        select: {
          id: true,
          reservationNumber: true,
          reservationDate: true,
          client: true,
          // TR-09. Cuanta gente se vendio, para poder preguntar cuanta vino
          // sin tener que ir a buscar la reserva.
          participants: true,
          experience: { select: { title: true } },
        },
      }),
    ]);

    return { seguimientos, prereservas, porCalificar };
  },

  /**
   * Marcar un seguimiento como hecho, o como que ya no aplica.
   *
   * No se borra nunca: NO_APLICA deja constancia de que existio y de que
   * alguien decidio que sobraba, que es distinto de que nunca hubiera estado.
   */
  async cerrarSeguimiento(
    id: string,
    companyId: string | null | undefined,
    status: 'HECHO' | 'NO_APLICA',
  ) {
    if (!companyId) throw Forbidden('No tienes una company asociada');
    // Se comprueba por la oportunidad: un seguimiento no tiene empresa propia,
    // y sin esto bastaria acertar un id para cerrar el de otra.
    const suyo = await prisma.followup.findFirst({
      where: { id, opportunity: { hostCompanyId: companyId } },
      select: { id: true, kind: true, opportunityId: true },
    });
    if (!suyo) throw NotFound('Seguimiento no encontrado');

    const cerrado = await prisma.followup.update({
      where: { id },
      data: { status, doneAt: status === 'HECHO' ? new Date() : null },
    });

    // Los recordatorios de propuesta son tres escalones de lo mismo. Al dar
    // uno por atendido, los que venian detras ya no tienen a quien perseguir.
    if (status === 'HECHO') {
      await retirarPropuestasPosteriores(suyo.opportunityId, suyo.kind);
    }
    return cerrado;
  },

  /**
   * CRM-26. Cerrar una experiencia que ya ocurrio.
   *
   * Es lo que resuelve el pendiente, y por eso vive aqui y no en reservas: el
   * panel decia "cierra o califica" y calificar no se podia hacer en ningun
   * sitio —`rating` existia en el modelo y nadie lo escribia nunca—, asi que
   * el aviso mandaba a una pantalla donde no estaba lo que pedia.
   *
   * Dos salidas, porque hay dos cosas que pueden haber pasado: se realizo, o
   * el comensal no se presento. Las dos cierran el pendiente; solo la primera
   * cuenta como venta y como experiencia prestada.
   */
  async cerrarExperiencia(
    reservationId: string,
    companyId: string | null | undefined,
    input: {
      resultado: 'REALIZADA' | 'NO_SE_PRESENTO';
      rating?: number;
      notas?: string;
      asistentes?: number;
    },
  ) {
    if (!companyId) throw Forbidden('No tienes una company asociada');

    const reserva = await prisma.reservation.findFirst({
      where: { id: reservationId, companyId },
      select: { id: true, notes: true, reservationDate: true, participants: true },
    });
    if (!reserva) throw NotFound('Reserva no encontrada');
    // Cerrar algo que todavia no ha ocurrido no es cerrarlo: es cancelarlo o
    // adelantarlo, y eso se hace desde la reserva.
    if (reserva.reservationDate > new Date()) {
      throw BadRequest('Esta experiencia todavía no ha ocurrido.');
    }

    // La nota se añade, no sustituye: lo que hubiera escrito antes sobre esta
    // reserva sigue siendo cierto.
    const notas = input.notas?.trim()
      ? [reserva.notes, input.notas.trim()].filter(Boolean).join('\n')
      : undefined;

    // TR-09. La asistencia se registra al cerrar, y no se presume: si no se
    // dice, una realizada vino completa y una que no se presento vino con
    // nadie. Eso es lo que significan esas dos palabras.
    const realizada = input.resultado === 'REALIZADA';
    const asistentes =
      input.asistentes ?? (realizada ? reserva.participants : 0);
    if (asistentes > reserva.participants) {
      throw BadRequest(
        `Se reservaron ${reserva.participants} ${
          reserva.participants === 1 ? 'persona' : 'personas'
        }: no pueden haber asistido ${asistentes}.`,
      );
    }

    // TR-24. Si vino alguien, se le pide que califique. Si no vino nadie no se
    // le pide nada: preguntarle que tal estuvo a quien no fue es la mejor
    // forma de recordarle que pago algo que no uso.
    const pedirleQueCalifique = realizada && asistentes > 0;
    const token = pedirleQueCalifique ? nuevoTokenDeCalificacion() : null;

    const cerrada = await prisma.reservation.update({
      where: { id: reservationId },
      data: {
        ...(token ? { ratingToken: token, ratingRequestedAt: new Date() } : {}),
        // Una realizada a la que no fue nadie es un no-show, lo diga como lo
        // diga quien cierra: si se guardara como completada, se cobraria como
        // una experiencia que no ocurrio.
        status: realizada && asistentes > 0 ? 'COMPLETED' : 'NO_SHOW',
        attendedCount: asistentes,
        ...(realizada && input.rating ? { rating: input.rating } : {}),
        ...(notas !== undefined ? { notes: notas } : {}),
      },
      select: {
        id: true,
        reservationNumber: true,
        status: true,
        rating: true,
        attendedCount: true,
        participants: true,
      },
    });

    if (token) {
      // Sin await: el pendiente se cierra ya, y el correo va detras. Si falla
      // el envio, la experiencia sigue cerrada y el anfitrion puede seguir.
      void (async () => {
        const datos = await cargarDatosDeReserva(reservationId);
        if (datos) await pedirCalificacion(datos, token);
      })();
    }

    return cerrada;
  },

  /**
   * Indicadores del periodo.
   *
   * Solo lo que se puede leer de un vistazo. El ticket promedio sale de las
   * ganadas y no de todas: promediar propuestas que nadie acepto daria una
   * cifra que no describe ninguna venta real.
   */
  async indicadores(companyId: string | null | undefined, desde: Date, hasta: Date) {
    if (!companyId) throw Forbidden('No tienes una company asociada');
    const rango = { gte: desde, lte: hasta };

    const [enviadas, ganadas, perdidas, abiertas, suma] = await Promise.all([
      prisma.opportunity.count({
        where: { hostCompanyId: companyId, deletedAt: null, proposalSentAt: rango },
      }),
      prisma.opportunity.count({
        where: { hostCompanyId: companyId, deletedAt: null, status: 'WON', actualCloseDate: rango },
      }),
      prisma.opportunity.count({
        where: { hostCompanyId: companyId, deletedAt: null, status: 'LOST', actualCloseDate: rango },
      }),
      prisma.opportunity.count({
        where: { hostCompanyId: companyId, deletedAt: null, status: 'OPEN' },
      }),
      prisma.opportunity.aggregate({
        where: { hostCompanyId: companyId, deletedAt: null, status: 'WON', actualCloseDate: rango },
        _sum: { value: true },
      }),
    ]);

    const ventas = Number(suma._sum.value ?? 0);
    return {
      propuestasEnviadas: enviadas,
      ganadas,
      perdidas,
      // Las abiertas no se acotan al periodo: una oportunidad de hace dos meses
      // sigue pendiente hoy, y esconderla seria enseñar menos trabajo del que hay.
      pendientes: abiertas,
      ventas,
      ticketPromedio: ganadas > 0 ? Math.round(ventas / ganadas) : 0,
    };
  },
};
