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
import { anotarCobroSinReserva } from './cobro-sin-reserva.js';
import { mercadoPagoDeLaPlataforma, pasarelaDeLaPlataforma, proveedorDeLaSuscripcion } from './pasarela.js';
import { URL_CHECKOUT, aCentavos, aEstadoDePago, firmaIntegridad, webhookValido } from './wompi.js';
import {
  cambiarEstadoDeMandato,
  crearMandato,
  firmaValida,
  leerCobroAutorizado,
  leerMandato,
  leerPago as leerPagoMp,
} from './mercadopago.js';

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
  /** Con que pasarela se cobra, la que decidio el administrador. */
  proveedor: 'WOMPI' | 'MERCADO_PAGO';
  /**
   * El cobro automatico del anfitrion, si lo autorizo. Solo Mercado Pago lo
   * tiene; con Wompi cada mes se paga a mano. null = nunca lo ha pedido.
   */
  renovacion: EstadoDeRenovacion | null;
};

export type EstadoDeRenovacion = 'PENDIENTE' | 'ACTIVA' | 'PAUSADA' | 'CANCELADA';

const RENOVACION_DE: Record<string, EstadoDeRenovacion> = {
  pending: 'PENDIENTE',
  authorized: 'ACTIVA',
  paused: 'PAUSADA',
  cancelled: 'CANCELADA',
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
        subscriptionMpStatus: true,
        owner: { select: { role: true } },
      },
    }),
    getPlatformSettings(),
  ]);

  const cobro = {
    ...conIva(Number(ajustes.subscriptionPrice), Number(ajustes.subscriptionVat)),
    proveedor: ajustes.subscriptionProvider === 'MERCADO_PAGO' ? ('MERCADO_PAGO' as const) : ('WOMPI' as const),
  };
  if (!empresa) {
    return {
      requerida: false, exenta: false, vigente: true, bloqueada: false,
      endsAt: null, diasRestantes: null, renovacion: null, ...cobro,
    };
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
    renovacion: empresa.subscriptionMpStatus ? (RENOVACION_DE[empresa.subscriptionMpStatus] ?? null) : null,
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

export type CheckoutDeWompi = {
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

/** Mercado Pago solo necesita que el navegador vaya a la URL donde se autoriza el cobro. */
export type CheckoutDeMercadoPago = {
  proveedor: 'MERCADO_PAGO';
  checkoutUrl: string;
};

export type CheckoutDeSuscripcion = CheckoutDeWompi | CheckoutDeMercadoPago;

/** Un intento de pago nuevo con la pasarela que el administrador haya elegido. */
export async function crearCheckoutDeSuscripcion(companyId: string): Promise<CheckoutDeSuscripcion> {
  return (await proveedorDeLaSuscripcion()) === 'MERCADO_PAGO'
    ? crearCheckoutDeMercadoPago(companyId)
    : crearCheckoutDeWompi(companyId);
}

/** Un intento de pago nuevo, firmado, listo para llevar al anfitrion a Wompi. */
async function crearCheckoutDeWompi(companyId: string): Promise<CheckoutDeWompi> {
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

// ── Mercado Pago: cobro automatico ──────────────────────────────────────────
//
// El anfitrion autoriza un mandato (preapproval) y Mercado Pago cobra cada 30
// dias. Cada cobro aprobado se registra como un SubscriptionPayment y pasa por
// el mismo `aplicarPago` que uno de Wompi: suma 30 dias y es idempotente.
//
// Dos cosas que ya costaron incidentes en happy-sapiens y aqui se cuidan:
//
//  1. Un mismo cobro llega por VARIAS notificaciones (`payment`,
//     `subscription_authorized_payment`, y reintentos). La unicidad la da la
//     referencia `SUB-MP<idDelPago>`: se llegue por donde se llegue, es la
//     misma fila y los dias se suman una sola vez.
//  2. El `subscription_authorized_payment` trae el id de un authorized_payment,
//     no el de un pago. Se resuelve primero (`leerCobroAutorizado`).

const MENSAJE_SIN_MP = 'El pago en línea no está disponible por ahora. Escríbenos y lo resolvemos.';

/** A donde Mercado Pago manda sus avisos de la suscripcion. */
export const urlDelWebhookDeSuscripcionMp = () =>
  `${env.API_PUBLIC_URL ?? env.APP_URL}/payments/mercadopago/suscripcion/webhook`;

async function crearCheckoutDeMercadoPago(companyId: string): Promise<CheckoutDeMercadoPago> {
  const mp = await mercadoPagoDeLaPlataforma();
  if (!mp) throw BadRequest(MENSAJE_SIN_MP);

  const { precio, total } = await estadoDeSuscripcion(companyId);
  if (!(precio > 0)) throw BadRequest('La suscripción no tiene un precio configurado.');

  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      companyEmail: true,
      subscriptionMpPreapprovalId: true,
      subscriptionMpStatus: true,
      owner: { select: { email: true } },
    },
  });
  if (!empresa) throw BadRequest('La empresa indicada no existe');
  if (empresa.subscriptionMpStatus === 'authorized') {
    throw BadRequest(
      'Ya tienes el cobro automático activo: Mercado Pago renueva tu suscripción cada 30 días.',
    );
  }
  const correo = empresa.owner.email || empresa.companyEmail;
  if (!correo) throw BadRequest('Tu cuenta no tiene un correo con el que autorizar el cobro.');

  // Un mandato pendiente de antes se cancela: si el anfitrion abriera ese
  // enlace viejo y lo autorizara, tendriamos dos cobrandole cada mes.
  if (empresa.subscriptionMpPreapprovalId && empresa.subscriptionMpStatus === 'pending') {
    await cambiarEstadoDeMandato(mp.accessToken, empresa.subscriptionMpPreapprovalId, 'cancelled').catch(
      () => false,
    );
  }

  const mandato = await crearMandato({
    accessToken: mp.accessToken,
    motivo: 'Suscripción mensual a Tenemos Filo',
    // El monto del mandato queda fijo en Mercado Pago: lo que cambie despues
    // en el precio solo alcanza a quien autorice desde ese momento.
    monto: total,
    dias: DIAS_POR_PAGO,
    // Solo el id de la empresa: Mercado Pago rechaza datos personales aqui.
    referencia: companyId,
    correoDelPagador: correo,
    notificationUrl: urlDelWebhookDeSuscripcionMp(),
    redirectUrl: `${env.APP_URL}/dashboard/suscripcion?pago=mp`,
  });
  if ('error' in mandato || !mandato.initPoint) {
    const motivo = 'error' in mandato ? mandato.error : 'Mercado Pago no devolvió el enlace de pago';
    logger.error({ companyId, motivo }, 'No se pudo crear el cobro automatico en Mercado Pago');
    // Una cuenta de Mercado Pago de otro pais no puede suscribirse desde Colombia.
    if (/different countries/i.test(motivo)) {
      throw BadRequest(
        'Tu cuenta de Mercado Pago está registrada en un país distinto a Colombia. Usa el correo de una cuenta colombiana.',
      );
    }
    throw BadRequest('No se pudo abrir el pago con Mercado Pago. Intenta de nuevo en un momento.');
  }

  await prisma.company.update({
    where: { id: companyId },
    data: { subscriptionMpPreapprovalId: mandato.id, subscriptionMpStatus: 'pending' },
  });
  return { proveedor: 'MERCADO_PAGO', checkoutUrl: mandato.initPoint };
}

/**
 * La empresa a la que pertenece un mandato.
 *
 * Primero por el id que guardamos al crearlo. Si no esta —el aviso de un cobro
 * puede adelantarse a todo— se cae a la referencia externa, que es el id de la
 * empresa, y se enlaza ahi. Sin este rescate un cobro real se descartaba por
 * llegar "antes" que su registro.
 */
async function empresaDelMandato(mandatoId: string, referencia: string | null) {
  const porMandato = await prisma.company.findUnique({
    where: { subscriptionMpPreapprovalId: mandatoId },
    select: { id: true },
  });
  if (porMandato) return porMandato;
  if (!referencia) return null;
  const porReferencia = await prisma.company.findUnique({ where: { id: referencia }, select: { id: true } });
  if (!porReferencia) return null;
  await prisma.company
    .update({ where: { id: porReferencia.id }, data: { subscriptionMpPreapprovalId: mandatoId } })
    // Otra empresa ya tiene ese id (no deberia): no se pisa, el cobro igual se atribuye.
    .catch(() => undefined);
  return porReferencia;
}

/** El estado del mandato manda: se relee de Mercado Pago, nunca del aviso. */
async function sincronizarMandato(accessToken: string, mandatoId: string): Promise<void> {
  const mandato = await leerMandato(accessToken, mandatoId);
  if (!mandato) {
    logger.warn({ mandatoId }, 'Mercado Pago no devolvio el mandato de la suscripcion');
    return;
  }
  const empresa = await empresaDelMandato(mandato.id, mandato.referencia);
  if (!empresa) {
    logger.warn({ mandatoId }, 'Mandato de Mercado Pago sin empresa conocida');
    return;
  }
  await prisma.company.update({
    where: { id: empresa.id },
    data: { subscriptionMpStatus: mandato.estado },
  });
}

async function procesarCobroDeMercadoPago(
  accessToken: string,
  pagoId: string,
  mandatoPista: string | null,
): Promise<void> {
  const pago = await leerPagoMp(accessToken, pagoId);
  if (!pago) {
    logger.warn({ pagoId }, 'Mercado Pago no devolvio el pago de la suscripcion');
    return;
  }
  // Este webhook es solo de la suscripcion: un pago sin mandato no es nuestro.
  const mandatoId = pago.preapprovalId ?? mandatoPista;
  if (!mandatoId) return;

  const empresa = await empresaDelMandato(mandatoId, pago.referencia);
  if (!empresa) {
    // Dinero cobrado que no se sabe de quien es: que quede a la vista.
    await anotarCobroSinReserva({
      gateway: 'MERCADO_PAGO',
      reference: mandatoId,
      transactionId: pago.id,
      amount: pago.monto,
      currency: 'COP',
      gatewayStatus: pago.estadoCrudo,
      event: pago.crudo,
    });
    return;
  }

  if (pago.estado === 'FAILED') {
    // Mercado Pago reintenta solo. No se toca nada: los dias pagados siguen
    // corriendo y, si el reintento entra, llegara como un cobro nuevo.
    logger.warn({ companyId: empresa.id, pagoId: pago.id, estado: pago.estadoCrudo }, 'Cobro automatico de suscripcion rechazado');
    return;
  }
  if (pago.estado === 'REFUNDED') {
    // No se quitan dias solos: devolver un pago es una decision de una persona
    // (puede ser parcial, o un contracargo en disputa). Se corrige desde el admin.
    logger.warn({ companyId: empresa.id, pagoId: pago.id }, 'Pago de suscripcion devuelto en Mercado Pago: revisar el vencimiento');
    return;
  }
  if (pago.estado !== 'PAID') return;

  // El monto cobrado es el del mandato, con IVA incluido; se desglosa con el IVA vigente.
  const { ivaPorcentaje } = await estadoDeSuscripcion(empresa.id);
  const base = Math.round(pago.monto / (1 + ivaPorcentaje / 100));
  const reference = `${PREFIJO_DE_SUSCRIPCION}MP${pago.id}`;

  let fila = await prisma.subscriptionPayment.findUnique({ where: { reference } });
  if (!fila) {
    try {
      fila = await prisma.subscriptionPayment.create({
        data: {
          companyId: empresa.id,
          reference,
          amount: pago.monto,
          baseAmount: base,
          vatAmount: pago.monto - base,
          method: 'MERCADO_PAGO',
          transactionId: pago.id,
        },
      });
    } catch (err) {
      // Dos avisos del mismo cobro a la vez: gana uno, el otro lee su fila.
      if ((err as { code?: string }).code !== 'P2002') throw err;
      fila = await prisma.subscriptionPayment.findUnique({ where: { reference } });
    }
  }
  if (!fila) return;

  // Un cobro aprobado prueba que el mandato esta vivo, aunque su propio aviso se retrase.
  await prisma.company.updateMany({
    where: { id: empresa.id, subscriptionMpStatus: { in: ['pending'] } },
    data: { subscriptionMpStatus: 'authorized' },
  });

  const sumo = await aplicarPago(fila.id, { transactionId: pago.id });
  if (sumo) void avisarPagoDeSuscripcion(empresa.id).catch(() => undefined);
}

type AvisoDeMercadoPago = {
  type?: string;
  topic?: string;
  data?: { id?: string | number };
  id?: string | number;
};

/**
 * Un aviso de Mercado Pago sobre la suscripcion.
 *
 * Como en el resto de pasarelas con Mercado Pago, el cuerpo solo trae un id y
 * NUNCA se cree su contenido: el estado se relee de su API con nuestro token.
 * La firma `x-signature` se exige solo si el administrador guardo el secreto.
 * Devuelve 401 solo ante una firma invalida; si algo falla al procesar, lanza
 * para que Mercado Pago reintente (todo aqui es idempotente).
 */
export async function procesarAvisoDeMercadoPago(
  aviso: AvisoDeMercadoPago,
  cabeceras: { xSignature?: string; xRequestId?: string },
): Promise<200 | 401> {
  const tipo = aviso.type ?? aviso.topic;
  const dataId = String(aviso.data?.id ?? aviso.id ?? '');
  if (!tipo || !dataId) return 200;

  const mp = await mercadoPagoDeLaPlataforma();
  if (!mp) {
    logger.error({ tipo }, 'Aviso de Mercado Pago de suscripcion sin la pasarela configurada');
    return 200;
  }

  if (mp.webhookSecret) {
    const valida = firmaValida({
      xSignature: cabeceras.xSignature,
      xRequestId: cabeceras.xRequestId,
      dataId,
      secreto: mp.webhookSecret,
    });
    if (!valida) {
      logger.warn({ tipo, dataId }, 'Aviso de Mercado Pago de suscripcion con firma invalida: descartado');
      return 401;
    }
  }

  if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
    await sincronizarMandato(mp.accessToken, dataId);
  } else if (tipo === 'subscription_authorized_payment') {
    const cobro = await leerCobroAutorizado(mp.accessToken, dataId);
    if (!cobro) {
      logger.warn({ dataId }, 'Mercado Pago no devolvio el cobro autorizado');
      return 200;
    }
    // Sin pago real todavia (programado o reintentandose): nada que registrar.
    if (cobro.pagoId) await procesarCobroDeMercadoPago(mp.accessToken, cobro.pagoId, cobro.mandatoId);
  } else if (tipo === 'payment') {
    await procesarCobroDeMercadoPago(mp.accessToken, dataId, null);
  }
  return 200;
}

/**
 * Dejar de renovar. Los dias ya pagados siguen: se cancela el cobro, no la
 * suscripcion. Cancelar en Mercado Pago no tiene vuelta; para volver a
 * renovar solo se autoriza un mandato nuevo.
 */
export async function cancelarRenovacionAutomatica(companyId: string): Promise<void> {
  const empresa = await prisma.company.findUnique({
    where: { id: companyId },
    select: { subscriptionMpPreapprovalId: true, subscriptionMpStatus: true },
  });
  const id = empresa?.subscriptionMpPreapprovalId;
  if (!id || !['authorized', 'paused', 'pending'].includes(empresa.subscriptionMpStatus ?? '')) {
    throw BadRequest('No tienes un cobro automático que cancelar.');
  }
  const mp = await mercadoPagoDeLaPlataforma();
  if (!mp) throw BadRequest(MENSAJE_SIN_MP);

  if (!(await cambiarEstadoDeMandato(mp.accessToken, id, 'cancelled'))) {
    throw BadRequest('Mercado Pago no pudo cancelar el cobro automático. Intenta de nuevo en un momento.');
  }
  await prisma.company.update({ where: { id: companyId }, data: { subscriptionMpStatus: 'cancelled' } });
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
    select: { id: true, subscriptionMpStatus: true },
  });

  let enviados = 0;
  for (const { id, subscriptionMpStatus } of empresas) {
    const { correos, nombre, endsAt } = await destinatarios(id);
    if (!endsAt || correos.length === 0) continue;

    const diasRestantes = (endsAt.getTime() - ahora) / MS_DIA;
    // Con el cobro automatico vivo, Mercado Pago renueva solo: decirle que
    // "vence en 7 dias" seria alarmarlo por nada. Si ya vencio, algo fallo (la
    // tarjeta) y ahi si hay que avisar.
    if (subscriptionMpStatus === 'authorized' && diasRestantes > 0) continue;
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
