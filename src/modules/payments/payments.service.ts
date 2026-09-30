import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { pasarelaDeLaReserva } from '../../lib/pasarela.js';
import { URL_CHECKOUT, aCentavos, firmaIntegridad } from '../../lib/wompi.js';
import { crearPreferencia } from '../../lib/mercadopago.js';
import { logger } from '../../lib/logger.js';

/**
 * Lo que el navegador necesita para llevar al cliente a pagar.
 *
 * Son dos formas distintas y no una con campos opcionales: en Wompi el
 * navegador arma un formulario firmado, y en Mercado Pago solo va a una URL
 * que ya creamos nosotros. Un tipo con todo opcional obligaria a cada
 * pantalla a adivinar cual de los dos casos tiene delante.
 */
export type CheckoutWompi = {
  proveedor: 'WOMPI';
  checkoutUrl: string;
  publicKey: string;
  currency: string;
  amountInCents: number;
  reference: string;
  signature: string;
  redirectUrl: string;
  environment: string;
};

export type CheckoutMercadoPago = {
  proveedor: 'MERCADO_PAGO';
  /** A donde se manda al cliente. La preferencia ya esta creada. */
  checkoutUrl: string;
  reference: string;
  currency: string;
  amount: number;
  environment: string;
};

export type DatosCheckout = CheckoutWompi | CheckoutMercadoPago;

/**
 * Datos para abrir el checkout de una reserva.
 *
 * Devuelve null en vez de lanzar cuando la pasarela no esta lista o la
 * reserva ya esta pagada: quien llama decide si eso es un error (endpoint
 * de pago) o simplemente "no hay que cobrar" (alta de reserva).
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
    select: {
      pricing: true,
      paymentStatus: true,
      companyId: true,
      collectedBy: true,
      client: true,
      experience: { select: { title: true } },
    },
  });
  if (!reserva || reserva.paymentStatus === 'PAID') return null;

  const total = Number((reserva.pricing as { total?: unknown })?.total ?? 0);
  if (!(total > 0)) return null;

  const pasarela = await pasarelaDeLaReserva(reserva.companyId, reserva.collectedBy);
  // Pasa cuando el anfitrion desconecta su pasarela con reservas suyas sin
  // pagar. No se cae a la de la plataforma a proposito: ese dinero le toca a
  // el y esa reserva no lleva comision descontada.
  if (!pasarela) return null;

  const currency = 'COP';
  const redirectUrl = opts?.redirectUrl ?? `${env.APP_URL}/pay/${reservationNumber}`;

  if (pasarela.proveedor === 'MERCADO_PAGO') {
    if (!pasarela.privateKey) return null;
    const cliente = (reserva.client ?? {}) as { email?: string | null };

    // Crear la preferencia es una llamada a su API, y puede fallar o tardar.
    // Que eso tumbe un alta de reserva seria peor que no poder cobrar en
    // linea: la reserva existe igual y el anfitrion puede cobrarla aparte.
    try {
      const preferencia = await crearPreferencia({
        accessToken: pasarela.privateKey,
        titulo: reserva.experience?.title ?? 'Reserva',
        monto: total,
        referencia: reservationNumber,
        // Lleva la empresa dentro: es lo unico que nos permite despues saber
        // con que token releer el pago que nos notifiquen.
        notificationUrl: `${env.API_PUBLIC_URL ?? env.APP_URL}/payments/mercadopago/webhook/${reserva.companyId}`,
        redirectUrl,
        entorno: pasarela.entorno,
        correoDelCliente: cliente.email ?? null,
      });
      if (!preferencia) {
        logger.error({ reservationNumber }, 'Mercado Pago no devolvio preferencia');
        return null;
      }
      return {
        proveedor: 'MERCADO_PAGO',
        checkoutUrl: preferencia.url,
        reference: reservationNumber,
        currency,
        amount: total,
        environment: pasarela.entorno,
      };
    } catch (err) {
      logger.error({ err, reservationNumber }, 'no se pudo crear la preferencia de Mercado Pago');
      return null;
    }
  }

  if (!pasarela.publicKey || !pasarela.integritySecret) return null;
  const amountInCents = aCentavos(total);

  return {
    proveedor: 'WOMPI',
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
    redirectUrl,
    environment: pasarela.entorno,
  };
}
