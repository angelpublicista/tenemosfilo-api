import { prisma } from '../../config/prisma.js';
import { Forbidden } from '../../lib/errors.js';

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
          experience: { select: { title: true } },
        },
      }),
    ]);

    return { seguimientos, prereservas, porCalificar };
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
