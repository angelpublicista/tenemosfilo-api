// Cobros que llegaron sin una reserva a la que colgarse (TR-44).
//
// El requisito dice que ningun cobro puede quedar sin reserva. Cumplirlo de
// verdad no es impedir que ocurra —no se puede: la pasarela cobra por su
// cuenta y nos lo cuenta despues— sino que no pase desapercibido. Antes era
// una linea en el log, asi que un cobro huerfano se perdia y el dinero
// quedaba en una cuenta sin nada que lo explicara.
import { prisma } from '../config/prisma.js';
import { logger } from './logger.js';

export interface CobroHuerfano {
  gateway: 'WOMPI' | 'MERCADO_PAGO' | 'BOLD';
  reference: string;
  transactionId?: string | null;
  amount?: number | null;
  currency?: string | null;
  gatewayStatus?: string | null;
  companyId?: string | null;
  event: unknown;
}

/**
 * Apunta el cobro huerfano. Nunca lanza.
 *
 * Se llama desde un webhook: si esto fallara y tumbara el handler, la pasarela
 * reintentaria sin fin un evento que de todas formas no se puede procesar.
 */
export async function anotarCobroSinReserva(datos: CobroHuerfano): Promise<void> {
  try {
    // Solo los que de verdad movieron dinero. Un evento de "rechazada" sin
    // reserva no es un cobro huerfano: no hay nada que devolverle a nadie, y
    // llenar la bandeja de ruido es la forma de que nadie la mire.
    const esDinero =
      !datos.gatewayStatus ||
      /APPROVED|PAID|approved|accredited|refunded|VOIDED/.test(datos.gatewayStatus);
    if (!esDinero) return;

    await prisma.orphanPayment.create({
      data: {
        gateway: datos.gateway,
        reference: datos.reference,
        transactionId: datos.transactionId ?? null,
        amount: datos.amount ?? null,
        currency: datos.currency ?? null,
        gatewayStatus: datos.gatewayStatus ?? null,
        companyId: datos.companyId ?? null,
        event: datos.event as never,
      },
    });
    logger.error(
      { gateway: datos.gateway, referencia: datos.reference, importe: datos.amount },
      'COBRO SIN RESERVA: anotado para revision',
    );
  } catch (e) {
    logger.error({ err: e, referencia: datos.reference }, 'no se pudo anotar el cobro sin reserva');
  }
}
