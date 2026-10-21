// Suscripcion de los anfitriones a la plataforma.
//
// Un plan, pago mensual sin permanencia: cada pago compra 30 dias, que se
// suman a los que ya queden, y no hay cobro automatico ni tarjeta guardada. Si
// no se paga, la suscripcion vence y el panel se bloquea hasta renovar.
//
// El administrador la enciende (`subscriptionRequired`). Apagada, nadie queda
// bloqueado: deja desplegar el codigo antes de decidir cuando empezar a cobrar.
import { randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';
import { logger } from './logger.js';
import { sendEmail } from './email.js';
import { armarCorreo } from './plantillas-de-correo.js';
import { getPlatformSettings } from './commissions.js';
import { pasarelaDeLaPlataforma } from './pasarela.js';
import { URL_CHECKOUT, aCentavos, aEstadoDePago, firmaIntegridad, webhookValido } from './wompi.js';

/** Lo que compra cada pago. */
export const DIAS_POR_PAGO = 30;
const MS_DIA = 24 * 60 * 60 * 1000;

/** Prefijo de la referencia que viaja a la pasarela; el webhook se guia por el. */
export const PREFIJO_DE_SUSCRIPCION = 'SUB-';

export type EstadoDeSuscripcion = {
  /** Se le exige: la plataforma la pide, la empresa es de un anfitrion y no esta exenta. */
  requerida: boolean;
  exenta: boolean;
  /** Tiene dias pagados, o no se le exige. */
  vigente: boolean;
  /** Se le exige y no la tiene: el panel queda cerrado. */
  bloqueada: boolean;
  endsAt: Date | null;
  diasRestantes: number | null;
  /** Lo que vale, sin IVA. */
  precio: number;
  ivaPorcentaje: number;
  iva: number;
  /** Lo que se cobra: precio + IVA. */
  total: number;
};

/**
 * El precio es sin IVA y el IVA se suma encima: lo que se cobra es
 * precio + IVA, redondeado a peso porque el peso no tiene centavos.
 */
export function conIva(precio: number, ivaPorcentaje: number) {
  const iva = Math.round((precio * ivaPorcentaje) / 100);
  return { precio, ivaPorcentaje, iva, total: precio + iva };
}

/**
 * El estado de una empresa. Siempre fresco: sirve para pintar su pantalla.
 * Para decidir en cada peticion se usa `estaBloqueada`, que cachea.
 */
export async function estadoDeSuscripcion(companyId: string): Promise<EstadoDeSuscripcion> {
  const [empresa, ajustes] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: {
        subscriptionEndsAt: true,
        subscriptionExempt: true,
        owner: { select: { role: true } },
      },
    }),
    getPlatformSettings(),
  ]);

  const cobro = conIva(Number(ajustes.subscriptionPrice), Number(ajustes.subscriptionVat));
  if (!empresa) {
    return { requerida: false, exenta: false, vigente: true, bloqueada: false, endsAt: null, diasRestantes: null, ...cobro };
  }

  // Solo los anfitriones pagan. Los revendedores venden lo de otros, y la
  // empresa de la casa es la plataforma misma.
  const esDeAnfitrion = empresa.owner.role === 'HOST' && ajustes.platformCompanyId !== companyId;
  const requerida = ajustes.subscriptionRequired && esDeAnfitrion && !empresa.subscriptionExempt;

  const endsAt = empresa.subscriptionEndsAt;
  const ahora = Date.now();
  const conDias = endsAt !== null && endsAt.getTime() > ahora;
  const vigente = !requerida || conDias;

  return {
    requerida,
    exenta: empresa.subscriptionExempt,
    vigente,
    bloqueada: requerida && !conDias,
    endsAt,
    diasRestantes: endsAt ? Math.ceil((endsAt.getTime() - ahora) / MS_DIA) : null,
    ...cobro,
  };
}

// ── Lo que se decide en cada peticion ───────────────────────────────────────
//
// Preguntar a la base por la suscripcion en CADA peticion del panel seria
// pagar una consulta por cada clic. Se recuerda un rato; todo lo que cambia el
// resultado (un pago, una exencion, el interruptor) lo olvida al momento.
const TTL_MS = 30_000;
const recordadas = new Map<string, { bloqueada: boolean; hasta: number }>();

export function olvidarSuscripciones(): void {
  recordadas.clear();
}

export async function estaBloqueada(companyId: string): Promise<boolean> {
  const ya = recordadas.get(companyId);
  if (ya && ya.hasta > Date.now()) return ya.bloqueada;
  const { bloqueada } = await estadoDeSuscripcion(companyId);
  recordadas.set(companyId, { bloqueada, hasta: Date.now() + TTL_MS });
  return bloqueada;
}

// ── Pagar ───────────────────────────────────────────────────────────────────

/**
 * Los dias se suman al pagarse, no al crear el intento.
 *
 * Si todavia le quedan dias, el pago se apila encima: pagar antes de tiempo no
 * puede hacerle perder lo que ya habia pagado. Idempotente: un webhook que se
 * reintenta no vuelve a sumar.
 */
export async function aplicarPago(
  pagoId: string,
  datos: { transactionId?: string | null } = {},
): Promise<boolean> {
  const aplicado = await prisma.$transaction(async (tx) => {
    const pago = await tx.subscriptionPayment.findUnique({
      where: { id: pagoId },
      select: { id: true, companyId: true, status: true },
    });
    if (!pago || pago.status === 'PAID') return false;

    const empresa = await tx.company.findUnique({
      where: { id: pago.companyId },
      select: { subscriptionEndsAt: true },
    });
    const ahora = new Date();
    const hasta = empresa?.subscriptionEndsAt;
    const inicio = hasta && hasta.getTime() > ahora.getTime() ? hasta : ahora;
    const fin = new Date(inicio.getTime() + DIAS_POR_PAGO * MS_DIA);

    const r = await tx.subscriptionPayment.updateMany({
      where: { id: pagoId, status: { not: 'PAID' } },
      data: {
        status: 'PAID',
        paidAt: ahora,
        periodStart: inicio,
        periodEnd: fin,
        ...(datos.transactionId ? { transactionId: datos.transactionId } : {}),
      },
    });
    if (r.count === 0) return false;

    await tx.company.update({ where: { id: pago.companyId }, data: { subscriptionEndsAt: fin } });
    return true;
  });
  olvidarSuscripciones();
  return aplicado;
}

export type CheckoutDeSuscripcion = {
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

/** Un intento de pago nuevo, firmado, listo para llevar al anfitrion a Wompi. */
export async function crearCheckoutDeSuscripcion(companyId: string): Promise<CheckoutDeSuscripcion> {
  const pasarela = await pasarelaDeLaPlataforma();
  if (!pasarela?.publicKey || !pasarela.integritySecret) {
    throw BadRequest('El pago en línea no está disponible por ahora. Escríbenos y lo resolvemos.');
  }

  const { precio, iva, total } = await estadoDeSuscripcion(companyId);
  if (!(precio > 0)) throw BadRequest('La suscripción no tiene un precio configurado.');

  // Una referencia nueva por intento: Wompi no admite reutilizar la de una
  // transaccion ya cerrada, y asi cada webhook apunta a un unico pago.
  const reference = `${PREFIJO_DE_SUSCRIPCION}${randomBytes(6).toString('hex').toUpperCase()}`;
  await prisma.subscriptionPayment.create({
    // Se congela lo que se cobra, desglosado: la factura es de esto, y el
    // precio o el IVA pueden cambiar mañana.
    data: { companyId, reference, amount: total, baseAmount: precio, vatAmount: iva, method: 'WOMPI' },
  });

  const amountInCents = aCentavos(total);
  return {
    proveedor: 'WOMPI',
    checkoutUrl: URL_CHECKOUT,
    publicKey: pasarela.publicKey,
    currency: 'COP',
    amountInCents,
    reference,
    signature: firmaIntegridad({
      reference,
      amountInCents,
      currency: 'COP',
      integritySecret: pasarela.integritySecret,
    }),
    redirectUrl: `${env.APP_URL}/dashboard/suscripcion?pago=${reference}`,
    environment: pasarela.entorno,
  };
}

/**
 * El evento de Wompi de un pago de suscripcion.
 *
 * Mismo criterio que con las reservas: nada se escribe hasta que la firma
 * cuadra, y se valida contra el secreto de eventos de LA PLATAFORMA —la
 * suscripcion se paga siempre a FILO, nunca a la pasarela de un anfitrion—.
 * Devuelve 401 solo ante una firma invalida; lo demas es 200 para que Wompi no
 * reintente algo que no va a cambiar.
 */
export async function procesarEventoDeSuscripcion(
  evento: Record<string, unknown>,
  transaccion: Record<string, unknown> | undefined,
): Promise<200 | 401> {
  const referencia = String(transaccion?.reference ?? '');
  const estado = String(transaccion?.status ?? '');

  const pago = await prisma.subscriptionPayment.findUnique({ where: { reference: referencia } });
  if (!pago) {
    logger.warn({ referencia }, 'Webhook de Wompi para un pago de suscripcion desconocido');
    return 200;
  }

  const pasarela = await pasarelaDeLaPlataforma();
  if (!pasarela?.eventsSecret) {
    logger.error({ referencia }, 'Webhook de suscripcion sin secreto de eventos de la plataforma');
    return 200;
  }
  if (!webhookValido(evento, pasarela.eventsSecret)) {
    logger.warn({ referencia }, 'Webhook de suscripcion con firma invalida: descartado');
    return 401;
  }

  const nuevo = aEstadoDePago(estado);
  const transactionId = typeof transaccion?.id === 'string' ? transaccion.id : null;

  if (nuevo === 'PAID') {
    // Lo cobrado tiene que ser lo que se pidio. La firma de integridad ya
    // ata el monto al checkout, pero no cuesta nada comprobarlo aqui.
    const centavos = transaccion?.amount_in_cents;
    if (typeof centavos === 'number' && centavos !== aCentavos(Number(pago.amount))) {
      logger.error({ referencia, centavos }, 'Pago de suscripcion con un monto distinto al pedido');
      return 200;
    }
    const sumo = await aplicarPago(pago.id, { transactionId });
    if (sumo) void avisarPagoDeSuscripcion(pago.companyId).catch(() => undefined);
    return 200;
  }

  if (nuevo === 'FAILED' && pago.status === 'PENDING') {
    await prisma.subscriptionPayment.updateMany({
      where: { id: pago.id, status: 'PENDING' },
      data: { status: 'FAILED', ...(transactionId ? { transactionId } : {}) },
    });
  }
  return 200;
}

// ── Correos ─────────────────────────────────────────────────────────────────

const fechaLarga = (d: Date) =>
  d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });

const pesos = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;

/** A quien se le escribe por la suscripcion de una empresa: el titular y su correo. */
async function destinatarios(companyId: string): Promise<{ correos: string[]; nombre: string; endsAt: Date | null }> {
  const e = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      companyName: true,
      companyEmail: true,
      subscriptionEndsAt: true,
      owner: { select: { email: true } },
    },
  });
  const correos = [...new Set([e?.owner?.email, e?.companyEmail].filter((c): c is string => !!c))];
  return { correos, nombre: e?.companyName ?? 'tu empresa', endsAt: e?.subscriptionEndsAt ?? null };
}

export async function avisarPagoDeSuscripcion(companyId: string): Promise<void> {
  const { correos, nombre, endsAt } = await destinatarios(companyId);
  if (!endsAt) return;
  // El primer pago activa la suscripcion y abre el panel; los siguientes son
  // renovaciones. Se cuentan los pagos ya aplicados (este incluido).
  const pagados = await prisma.subscriptionPayment.count({ where: { companyId, status: 'PAID' } });
  const { subject, html } = await armarCorreo(pagados <= 1 ? 'suscripcion_activa' : 'suscripcion_renovada', {
    empresa: nombre,
    fecha: fechaLarga(endsAt),
  });
  await Promise.all(correos.map((to) => sendEmail({ to, subject, html }).catch(() => false)));
}

/**
 * Los avisos de renovacion. Se llama cada pocas horas y es idempotente: cada
 * aviso lleva una clave con la fecha de vencimiento, asi que el mismo ciclo no
 * avisa dos veces y el siguiente (otra fecha) si.
 */
export async function enviarRecordatoriosDeSuscripcion(): Promise<number> {
  const ajustes = await getPlatformSettings();
  if (!ajustes.subscriptionRequired) return 0;

  const ahora = Date.now();
  const empresas = await prisma.company.findMany({
    where: {
      deletedAt: null,
      subscriptionExempt: false,
      subscriptionEndsAt: { not: null, lte: new Date(ahora + 7 * MS_DIA), gte: new Date(ahora - 3 * MS_DIA) },
      owner: { role: 'HOST' },
      ...(ajustes.platformCompanyId ? { id: { not: ajustes.platformCompanyId } } : {}),
    },
    select: { id: true },
  });

  let enviados = 0;
  for (const { id } of empresas) {
    const { correos, nombre, endsAt } = await destinatarios(id);
    if (!endsAt || correos.length === 0) continue;

    const diasRestantes = (endsAt.getTime() - ahora) / MS_DIA;
    const cuando =
      diasRestantes <= 0 ? 'vencida' : diasRestantes <= 1 ? 'un_dia' : 'siete_dias';
    const clave = `subscription:${id}:${endsAt.toISOString().slice(0, 10)}:${cuando}`;

    try {
      await prisma.communicationLog.create({
        data: { key: clave, templateId: `SUB-${cuando}`, recipients: correos },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') continue; // ya se avisó
      logger.error({ err, clave }, 'no se pudo reclamar el recordatorio de suscripcion');
      continue;
    }

    const precio = `${pesos(conIva(Number(ajustes.subscriptionPrice), Number(ajustes.subscriptionVat)).total)} (IVA incluido)`;
    const { subject, html } = await armarCorreo(`recordatorio_${cuando}` as const, {
      empresa: nombre,
      fecha: fechaLarga(endsAt),
      precio,
    });
    const salio = await Promise.all(
      correos.map((to) => sendEmail({ to, subject, html }).catch(() => false)),
    );
    if (salio.some(Boolean)) {
      enviados += 1;
    } else {
      // Que un fallo del proveedor no deje el aviso dado por enviado.
      await prisma.communicationLog.delete({ where: { key: clave } }).catch(() => undefined);
    }
  }
  return enviados;
}
