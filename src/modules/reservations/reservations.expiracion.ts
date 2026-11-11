// Reservas del catalogo que nadie pago.
//
// Con pago obligatorio, una reserva sin pagar deja de apartar su cupo a los
// RETENCION_DE_CUPO_MIN minutos (lib/cupos.ts), pero seguia en el panel como
// "pendiente" para siempre. Esto las cierra pasado un margen mayor que esa
// ventana: la pasarela puede tardar en avisar y no se le quita la reserva a
// quien esta pagando justo ahora.
//
// Se marcan como CANCELLED con motivo "Expiró sin pago" y `expired: true` en
// `cancellation`, y no con un estado nuevo: todo el sistema —aforo, agenda,
// fees, payouts— ya excluye CANCELLED, y un estado mas habria que excluirlo en
// cada uno de esos sitios.
//
// El comprador NO sale del CRM: la reserva conserva su `contactId` y el
// contacto no se toca. Sigue siendo prospecto —una reserva sin pagar nunca
// conto como venta (lib/condicion-de-cliente.ts)— y, si venia de una
// oportunidad, esta queda sin reserva viva y se puede volver a vender.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { cambio } from '../../lib/historial-de-reserva.js';
import { logger } from '../../lib/logger.js';
import { ajustesDeOperacion } from './reservations.service.js';

/** Cuanto se espera antes de darla por perdida. La retencion del cupo es de 20. */
export const EXPIRA_SIN_PAGO_MIN = 60;

export const MOTIVO_DE_EXPIRACION = 'Expiró sin pago';

/**
 * Expira las reservas del catalogo que siguen sin pagar. Devuelve cuantas.
 *
 * Idempotente: cada actualizacion vuelve a comprobar que siga sin pagar, asi
 * que dos instancias a la vez, o un pago que entra mientras corre, no se pisan.
 */
export async function expirarReservasSinPago(): Promise<number> {
  const limite = new Date(Date.now() - EXPIRA_SIN_PAGO_MIN * 60_000);

  const candidatas = await prisma.reservation.findMany({
    where: {
      // Lo que entra por el catalogo. Lo que carga el anfitrion a mano no pasa
      // por la pasarela y es decision suya: no se le cancela.
      source: 'BOOKING_ENGINE',
      status: { in: ['PENDING', 'CONFIRMED'] },
      paymentStatus: { in: ['PENDING', 'FAILED'] },
      paidAmount: { lte: 0 },
      createdAt: { lt: limite },
    },
    select: { id: true, companyId: true, status: true, pricing: true, changes: true },
  });
  if (candidatas.length === 0) return 0;

  // Solo donde de verdad se exige pago: sin pasarela, o con la empresa
  // cobrando en el sitio, "sin pagar" no quiere decir "abandonada".
  const exigePago = new Map<string, boolean>();
  for (const { companyId } of candidatas) {
    if (!exigePago.has(companyId)) {
      exigePago.set(companyId, (await ajustesDeOperacion(companyId)).exigePago);
    }
  }

  let expiradas = 0;
  for (const r of candidatas) {
    if (!exigePago.get(r.companyId)) continue;
    // Una experiencia gratuita no tiene nada que pagar.
    const total = Number((r.pricing as { total?: number } | null)?.total ?? 0);
    if (!(total > 0)) continue;

    try {
      const { count } = await prisma.reservation.updateMany({
        where: {
          id: r.id,
          status: { in: ['PENDING', 'CONFIRMED'] },
          paymentStatus: { in: ['PENDING', 'FAILED'] },
          paidAmount: { lte: 0 },
        },
        data: {
          status: 'CANCELLED',
          cancellation: {
            cancelledAt: new Date().toISOString(),
            cancelledBy: 'system',
            cancellationReason: MOTIVO_DE_EXPIRACION,
            expired: true,
            refundAmount: 0,
            refundStatus: null,
          } as Prisma.InputJsonValue,
          changes: [
            ...(r.changes as Prisma.InputJsonValue[]),
            cambio('status', r.status, 'CANCELLED', { email: 'sistema' }, MOTIVO_DE_EXPIRACION) as unknown as Prisma.InputJsonValue,
          ],
        },
      });
      expiradas += count;
    } catch (err) {
      logger.error({ err, reservationId: r.id }, 'no se pudo expirar una reserva sin pago');
    }
  }

  if (expiradas > 0) logger.info({ expiradas }, 'reservas sin pago expiradas');
  return expiradas;
}
