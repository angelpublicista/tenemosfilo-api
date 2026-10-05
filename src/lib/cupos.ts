// Los cupos de una experiencia en un dia: quien los ocupa y quien no puede.
//
// Vive aparte porque el aforo se toca desde cuatro sitios —el checkout
// publico, la carga a mano, el enlace de una oportunidad y la venta de un
// canal— y el ultimo cupo tiene que venderse una sola vez entre todos
// (TR-45). Si cada entrada contara a su manera, dos de ellas venderian la
// misma plaza y el anfitrion se enteraria en la puerta.
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';

/** El cliente de Prisma dentro o fuera de una transaccion. */
type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Cuanto retiene un cupo una reserva sin pagar, cuando el pago es
 * obligatorio (TR-05).
 *
 * Es el tiempo de ir a la pasarela y volver. Sin retencion, dos personas
 * pagan a la vez el ultimo cupo y una de las dos se queda con un cobro y
 * sin sitio. Con retencion para siempre, cada checkout abandonado se queda
 * una plaza real que nadie mas puede comprar. Veinte minutos es el punto
 * medio: sobra para pagar y no castiga al que se arrepiente.
 */
export const RETENCION_DE_CUPO_MIN = 20;

/** El dia natural de una fecha, de las 00:00 a las 00:00 siguientes. */
export function dia(fecha: Date): { inicio: Date; fin: Date } {
  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 1);
  return { inicio, fin };
}

/**
 * Las reservas que ocupan sitio ese dia.
 *
 * Canceladas y no-show no ocupan. Una pendiente si: puede pagarse en
 * cualquier momento, y vender su lugar a otro seria peor que rechazar esta.
 *
 * Con pago obligatorio la pendiente solo retiene mientras dura su ventana
 * (ver `RETENCION_DE_CUPO_MIN`). Las cargadas a mano por el anfitrion
 * retienen siempre: no pasaron por la pasarela y son decision suya.
 */
export function ocupanElDia(
  experienceId: string,
  fecha: Date,
  exigePago: boolean,
): Prisma.ReservationWhereInput {
  const { inicio, fin } = dia(fecha);
  const desde = new Date(Date.now() - RETENCION_DE_CUPO_MIN * 60_000);

  return {
    experienceId,
    status: { notIn: ['CANCELLED', 'NO_SHOW'] },
    reservationDate: { gte: inicio, lt: fin },
    ...(exigePago
      ? {
          OR: [
            { paymentStatus: 'PAID' as const },
            { source: 'MANUAL' as const },
            { createdAt: { gte: desde } },
          ],
        }
      : {}),
  };
}

/** Cuantos lugares quedan ese dia. `null` si la experiencia no define aforo. */
export async function cuposLibres(
  cliente: Cliente,
  experienceId: string,
  fecha: Date,
  exigePago: boolean,
): Promise<number | null> {
  const exp = await cliente.experience.findUnique({
    where: { id: experienceId },
    select: { capacity: true },
  });
  const aforo = exp?.capacity ?? 0;
  if (aforo <= 0) return null;

  const agregado = await cliente.reservation.aggregate({
    where: ocupanElDia(experienceId, fecha, exigePago),
    _sum: { participants: true },
  });
  return aforo - (agregado._sum?.participants ?? 0);
}

/** Rechaza la reserva si pasa del aforo, cuando la empresa lo pide. */
export async function verificarAforo(
  experienceId: string,
  fecha: Date,
  participantes: number,
  bloquearLleno: boolean,
  exigePago = false,
  cliente: Cliente = prisma,
) {
  if (!bloquearLleno) return;

  const libres = await cuposLibres(cliente, experienceId, fecha, exigePago);
  if (libres === null) return;

  if (participantes > libres) {
    throw BadRequest(
      libres > 0
        ? `Solo quedan ${libres} ${libres === 1 ? 'lugar' : 'lugares'} para esa fecha.`
        : 'No quedan lugares disponibles para esa fecha.',
    );
  }
}

/**
 * Hace la comprobacion de aforo y el alta como una sola cosa (TR-45).
 *
 * Comprobar y crear por separado deja una rendija: entre las dos consultas
 * cabe otra venta, y las dos se creen con sitio. Aqui las dos van en la
 * misma transaccion detras de un cerrojo por experiencia y dia, asi que la
 * segunda espera a que la primera acabe y se encuentra el cupo ya contado.
 *
 * El cerrojo es por experiencia y dia a proposito: dos ventas de sabados
 * distintos no tienen por que esperarse, y dos del mismo sabado si.
 *
 * `pg_advisory_xact_lock` se suelta al cerrar la transaccion, pase lo que
 * pase: no hay cerrojo que quede colgado si algo revienta en medio.
 */
export async function conCupoApartado<T>(
  experienceId: string,
  fecha: Date,
  participantes: number,
  ajustes: { bloquearLleno: boolean; exigePago: boolean },
  alta: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const { inicio } = dia(fecha);
  const clave = `${experienceId}:${inicio.toISOString().slice(0, 10)}`;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${clave}, 0))`;
      await verificarAforo(
        experienceId,
        fecha,
        participantes,
        ajustes.bloquearLleno,
        ajustes.exigePago,
        tx,
      );
      return alta(tx);
    },
    // Esperar por el cerrojo cuenta dentro del tiempo de la transaccion. Se
    // da margen para una cola corta sin dejar que una venta se eternice.
    { timeout: 20_000, maxWait: 10_000 },
  );
}
