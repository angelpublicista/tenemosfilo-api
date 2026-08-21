import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { getPlatformSettings } from '../../lib/commissions.js';
import { URL_CHECKOUT, aCentavos, firmaIntegridad } from '../../lib/wompi.js';

export type DatosCheckout = {
  checkoutUrl: string;
  publicKey: string;
  currency: string;
  amountInCents: number;
  reference: string;
  signature: string;
  redirectUrl: string;
  environment: string;
};

/**
 * Datos firmados para abrir el checkout de una reserva.
 *
 * Devuelve null en vez de lanzar cuando la pasarela no esta lista o la
 * reserva ya esta pagada: quien llama decide si eso es un error (endpoint
 * de pago) o simplemente "no hay que cobrar" (alta de reserva).
 *
 * La firma se calcula aqui porque necesita el secreto de integridad, que no
 * puede salir del servidor.
 */
export async function construirCheckout(
  reservationNumber: string,
  opts?: { redirectUrl?: string },
): Promise<DatosCheckout | null> {
  const ajustes = await getPlatformSettings();
  if (!ajustes.wompiEnabled || !ajustes.wompiPublicKey || !ajustes.wompiIntegritySecret) {
    return null;
  }

  const reserva = await prisma.reservation.findUnique({
    where: { reservationNumber },
    select: { pricing: true, paymentStatus: true },
  });
  if (!reserva || reserva.paymentStatus === 'PAID') return null;

  const total = Number((reserva.pricing as { total?: unknown })?.total ?? 0);
  if (!(total > 0)) return null;

  const amountInCents = aCentavos(total);
  const currency = 'COP';

  return {
    checkoutUrl: URL_CHECKOUT,
    publicKey: ajustes.wompiPublicKey,
    currency,
    amountInCents,
    reference: reservationNumber,
    signature: firmaIntegridad({
      reference: reservationNumber,
      amountInCents,
      currency,
      integritySecret: ajustes.wompiIntegritySecret,
    }),
    redirectUrl: opts?.redirectUrl ?? `${env.APP_URL}/pay/${reservationNumber}`,
    environment: ajustes.wompiEnvironment,
  };
}
