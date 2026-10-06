// Cuantas reservas puede producir una oportunidad (TR-14).
//
// Una cotizacion pone hasta tres opciones sobre la mesa, y un corporativo que
// acepta dos de las tres compra dos cenas. Hasta ahora el CRM permitia una
// sola reserva por oportunidad, asi que la segunda habia que crearla suelta y
// se perdia de vista en la venta que la origino.
import { prisma } from '../config/prisma.js';

/**
 * El tope de reservas de una oportunidad.
 *
 * Es cuantas opciones eligio el cliente en la cotizacion vigente, o una si no
 * hay opciones: lo de siempre. No se cuenta por opciones OFRECIDAS: ofrecer
 * tres fechas no autoriza a venderle tres cenas a quien pidio una.
 */
export async function reservasQueAdmite(opportunityId: string): Promise<number> {
  const vigente = await prisma.quote.findFirst({
    where: { opportunityId },
    orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
    select: { options: { where: { chosenAt: { not: null } }, select: { id: true } } },
  });
  return Math.max(1, vigente?.options.length ?? 0);
}
