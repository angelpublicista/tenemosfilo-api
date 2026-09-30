import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { pasarelaDeLaReserva } from '../../lib/pasarela.js';
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
 *
 * Con que pasarela se cobra no se decide aqui: lo dice la propia reserva. Si
 * nacio con cobro directo lleva la comision de FILO en cero, y cobrarla en la
 * cuenta de FILO seria quedarse con dinero del anfitrion; si nacio con cobro
 * de plataforma lleva la comision descontada, y cobrarla en la cuenta del
 * anfitrion se la regalaria.
 */
export async function construirCheckout(
  reservationNumber: string,
  opts?: { redirectUrl?: string },
): Promise<DatosCheckout | null> {
  const reserva = await prisma.reservation.findUnique({
    where: { reservationNumber },
    select: { pricing: true, paymentStatus: true, companyId: true, collectedBy: true },
  });
  if (!reserva || reserva.paymentStatus === 'PAID') return null;

  const total = Number((reserva.pricing as { total?: unknown })?.total ?? 0);
  if (!(total > 0)) return null;

  const pasarela = await pasarelaDeLaReserva(reserva.companyId, reserva.collectedBy);
  // Pasa cuando el anfitrion desconecta su pasarela con reservas suyas sin
  // pagar. No se cae a la de la plataforma a proposito: ese dinero le toca a
  // el y esa reserva no lleva comision descontada.
  if (!pasarela) return null;

  // Mercado Pago no firma asi ni abre este checkout. Mientras no este
  // integrado, decir que no se puede cobrar es mas honesto que mandar al
  // cliente a un checkout de Wompi con credenciales que no son de Wompi.
  if (pasarela.proveedor !== 'WOMPI') return null;

  const amountInCents = aCentavos(total);
  const currency = 'COP';

  return {
    checkoutUrl: URL_CHECKOUT,
    publicKey: pasarela.publicKey,
    currency,
    amountInCents,
    reference: reservationNumber,
    signature: firmaIntegridad({
      reference: reservationNumber,
      amountInCents,
      currency,
      integritySecret: pasarela.integritySecret,
    }),
    redirectUrl: opts?.redirectUrl ?? `${env.APP_URL}/pay/${reservationNumber}`,
    environment: pasarela.entorno,
  };
}
