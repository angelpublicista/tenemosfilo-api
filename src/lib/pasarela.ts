// Quien cobra una reserva, y con que credenciales.
//
// Hay dos formas de cobrar y conviene no confundirlas:
//
//   PLATFORM — el cliente le paga a FILO, que descuenta su comision y la del
//              revendedor y despues dispersa. Es como funciono siempre.
//   HOST     — el anfitrion conecto su propia pasarela y el dinero entra
//              directo a su cuenta. FILO no lo toca, asi que no cobra
//              comision; la del revendedor se sigue devengando pero la debe
//              el anfitrion, que es quien recibio el dinero.
//
// Todo lo que decide entre las dos vive aqui. Repartirlo entre el checkout,
// el webhook y las dispersiones seria pedir que tres sitios coincidan.
import type { CollectedBy, PaymentProvider } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { getPlatformSettings } from './commissions.js';
import { descifrar, descifrarHeredado } from './cripto.js';

export type Pasarela = {
  quienCobra: CollectedBy;
  proveedor: PaymentProvider;
  entorno: 'SANDBOX' | 'PRODUCTION';
  /**
   * Wompi la necesita en el navegador. Mercado Pago no la usa para cobrar. En
   * Bold es la llave de identidad, con la que se crean los links de pago.
   */
  publicKey: string | null;
  /**
   * El access token en Mercado Pago; en Wompi, su llave privada; en Bold, la
   * llave secreta con la que firma sus notificaciones.
   */
  privateKey: string | null;
  /** Solo Wompi: firma los datos del checkout. */
  integritySecret: string | null;
  /** Puede faltar: sin el no se validan webhooks, pero si se puede cobrar. */
  eventsSecret: string | null;
};

/**
 * Si con esta configuracion se puede cobrar de verdad.
 *
 * Cada pasarela necesita cosas distintas y no se puede preguntar por las de
 * Wompi a las tres: Mercado Pago no tiene secreto de integridad —firma del
 * lado del servidor creando una preferencia— y su llave publica no
 * interviene en el cobro.
 *
 * Bold cobra solo con la llave de identidad, pero se le exige tambien la
 * secreta: sin ella no se puede validar la notificacion, que es lo unico que
 * nos dice que pagaron. Cobrar sin poder enterarse dejaria reservas pagadas
 * sin confirmar.
 */
export function puedeCobrar(p: {
  proveedor: PaymentProvider;
  publicKey: string | null;
  privateKey: string | null;
  integritySecret: string | null;
}): boolean {
  switch (p.proveedor) {
    case 'MERCADO_PAGO':
      return Boolean(p.privateKey);
    case 'BOLD':
      return Boolean(p.publicKey && p.privateKey);
    default:
      return Boolean(p.publicKey && p.integritySecret);
  }
}

const SELECT_PASARELA = {
  paymentProvider: true,
  paymentGatewayEnabled: true,
  paymentEnvironment: true,
  gatewayPublicKey: true,
  gatewayPrivateKey: true,
  gatewayIntegritySecret: true,
  gatewayEventsSecret: true,
} as const;

type FilaDeEmpresa = {
  paymentProvider: PaymentProvider | null;
  paymentGatewayEnabled: boolean;
  paymentEnvironment: 'SANDBOX' | 'PRODUCTION';
  gatewayPublicKey: string | null;
  gatewayPrivateKey: string | null;
  gatewayIntegritySecret: string | null;
  gatewayEventsSecret: string | null;
};

/**
 * La pasarela del anfitrion, si de verdad puede cobrar con ella.
 *
 * "Activa" no basta: hace falta que las credenciales esten y se puedan
 * descifrar. Si la llave maestra cambio o falta, esto devuelve null y el
 * cobro cae a la plataforma en vez de fallar — pero entonces la comision ya
 * no cuadra con lo que se congelo en la reserva, y por eso el checkout
 * comprueba ademas contra `collectedBy`.
 */
export function pasarelaDelAnfitrion(c: FilaDeEmpresa | null): Pasarela | null {
  if (!c?.paymentGatewayEnabled || !c.paymentProvider) return null;

  const p: Pasarela = {
    quienCobra: 'HOST',
    proveedor: c.paymentProvider,
    entorno: c.paymentEnvironment,
    publicKey: c.gatewayPublicKey,
    privateKey: descifrar(c.gatewayPrivateKey),
    integritySecret: descifrar(c.gatewayIntegritySecret),
    eventsSecret: descifrar(c.gatewayEventsSecret),
  };
  return puedeCobrar(p) ? p : null;
}

/**
 * La de la plataforma, si esta lista.
 *
 * Sus secretos van cifrados igual que los de los anfitriones: cobran dinero
 * de verdad, y no habia motivo para que las nuestras fueran las unicas en
 * claro. `descifrarHeredado` cubre las que se guardaron antes del cifrado.
 */
export async function pasarelaDeLaPlataforma(): Promise<Pasarela | null> {
  const a = await getPlatformSettings();
  if (!a.wompiEnabled || !a.wompiPublicKey) return null;
  const p: Pasarela = {
    quienCobra: 'PLATFORM',
    proveedor: 'WOMPI',
    entorno: a.wompiEnvironment,
    publicKey: a.wompiPublicKey,
    privateKey: descifrarHeredado(a.wompiPrivateKey),
    integritySecret: descifrarHeredado(a.wompiIntegritySecret),
    eventsSecret: descifrarHeredado(a.wompiEventsSecret),
  };
  // La comprobacion va DESPUES de descifrar: un secreto que no se puede
  // descifrar es un secreto que no sirve, y decir que la pasarela esta lista
  // llevaria a firmar el checkout con null.
  return puedeCobrar(p) ? p : null;
}

/**
 * Con que se cobraria HOY una venta de esta empresa.
 *
 * La del anfitrion manda sobre la de la plataforma: si se molesto en
 * conectarla, es porque quiere el dinero en su cuenta.
 */
export async function pasarelaDe(companyId: string): Promise<Pasarela | null> {
  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: SELECT_PASARELA,
  });
  return pasarelaDelAnfitrion(empresa) ?? (await pasarelaDeLaPlataforma());
}

/**
 * La pasarela con la que hay que cobrar una reserva CONCRETA.
 *
 * No es lo mismo que `pasarelaDe`: una reserva vieja se cobra con quien la
 * cobraba el dia que se creo. Si el anfitrion conecto su pasarela ayer, una
 * reserva de la semana pasada lleva la comision de FILO descontada y tiene que
 * pagarse a FILO; cobrarla en su cuenta le regalaria esa comision al cliente
 * de nadie. Y al reves: una reserva creada con cobro directo, sin comision de
 * FILO, no puede acabar cobrandose en la cuenta de FILO.
 *
 * Por eso devuelve null cuando el anfitrion desconecta su pasarela con
 * reservas suyas sin pagar: preferible no poder cobrarlas —y decirlo— a
 * cobrarlas en la cuenta equivocada.
 */
export async function pasarelaDeLaReserva(
  companyId: string,
  quienCobra: CollectedBy,
): Promise<Pasarela | null> {
  if (quienCobra === 'PLATFORM') return pasarelaDeLaPlataforma();
  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: SELECT_PASARELA,
  });
  return pasarelaDelAnfitrion(empresa);
}

/**
 * De cuales de estas empresas se puede cobrar en linea ahora mismo.
 *
 * Existe para el catalogo del revendedor, que enseña experiencias de varias
 * empresas a la vez. Con la pasarela de la plataforma encendida se puede
 * cobrar de todas —es la que usan las que no tienen la suya—; con ella
 * apagada, solo de las que conectaron una propia.
 */
export async function empresasQuePuedenCobrar(companyIds: string[]): Promise<Set<string>> {
  const plataforma = await pasarelaDeLaPlataforma();
  if (plataforma) return new Set(companyIds);

  const empresas = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, ...SELECT_PASARELA },
  });
  return new Set(empresas.filter((c) => pasarelaDelAnfitrion(c) !== null).map((c) => c.id));
}
