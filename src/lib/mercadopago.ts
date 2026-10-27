// Integracion con Mercado Pago (Checkout Pro).
//
// Funciona al reves que Wompi y conviene tenerlo claro:
//
//   Wompi         — el servidor firma unos datos y el navegador los manda al
//                   checkout. No hablamos con Wompi para cobrar.
//   Mercado Pago  — el servidor crea una "preferencia" contra su API y
//                   recibe una URL; el navegador solo va a esa URL.
//
// Y la notificacion tambien: Wompi manda el estado dentro del evento, firmado.
// Mercado Pago manda solo un id, y el estado hay que preguntarselo a su API.
// Eso resulta ser mas seguro —el estado que aplicamos viene de una respuesta
// suya autenticada con el token del anfitrion, no del cuerpo de una peticion
// que cualquiera puede enviar— y por eso aqui NUNCA se lee el estado del
// webhook: se relee el pago.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/** Se puede apuntar a otro host en pruebas; por defecto, el de verdad. */
const API = env.MERCADOPAGO_API_URL ?? 'https://api.mercadopago.com';

/** Lo poco que necesitamos de un pago suyo. */
export type PagoDeMercadoPago = {
  id: string;
  estado: 'PAID' | 'FAILED' | 'PENDING' | 'REFUNDED';
  estadoCrudo: string;
  /** Nuestro numero de reserva: se lo mandamos al crear la preferencia. */
  referencia: string | null;
  monto: number;
  /**
   * El mandato de cobro automatico al que pertenece, si es un cobro recurrente.
   * Mercado Pago no lo manda en un solo sitio (ver `leerPago`).
   */
  preapprovalId: string | null;
  crudo: unknown;
};

/**
 * Estados de Mercado Pago mapeados a los nuestros.
 *
 * `in_process` y `pending` son pagos que todavia pueden aprobarse —un PSE a
 * medias, un efectivo sin pagar— y no son un rechazo: dejarlos en FAILED
 * cancelaria reservas que si van a pagarse.
 */
export function aEstadoDePago(estado: string): PagoDeMercadoPago['estado'] {
  switch (estado) {
    case 'approved':
      return 'PAID';
    case 'rejected':
    case 'cancelled':
      return 'FAILED';
    case 'refunded':
    case 'charged_back':
      return 'REFUNDED';
    default:
      return 'PENDING';
  }
}

/**
 * Las credenciales de prueba de Mercado Pago empiezan por `TEST-`.
 *
 * Cruzarlas con el entorno equivocado es el mismo error facil y dificil de
 * diagnosticar que con Wompi: los pagos no entran y nadie sabe por que.
 */
export function credencialCoincideConEntorno(
  credencial: string | null | undefined,
  entorno: 'SANDBOX' | 'PRODUCTION',
): boolean {
  if (!credencial) return true;
  const esDePruebas = credencial.startsWith('TEST-');
  if (!esDePruebas) return true; // APP_USR- sirve para los dos
  return entorno === 'SANDBOX';
}

export type PreferenciaCreada = { url: string; preferenceId: string };

/**
 * Crea la preferencia y devuelve a donde hay que mandar al cliente.
 *
 * `notification_url` va en la propia preferencia, no configurada en el panel
 * de Mercado Pago: asi el anfitrion no tiene que pegar ninguna URL a mano, y
 * lleva dentro de que empresa es el cobro —que es lo unico que nos permite
 * saber despues con que token releer el pago.
 */
export async function crearPreferencia(params: {
  accessToken: string;
  titulo: string;
  monto: number;
  referencia: string;
  notificationUrl: string;
  redirectUrl: string;
  entorno: 'SANDBOX' | 'PRODUCTION';
  correoDelCliente?: string | null;
}): Promise<PreferenciaCreada | null> {
  const cuerpo = {
    items: [
      {
        title: params.titulo,
        quantity: 1,
        unit_price: params.monto,
        currency_id: 'COP',
      },
    ],
    external_reference: params.referencia,
    notification_url: params.notificationUrl,
    back_urls: {
      success: params.redirectUrl,
      pending: params.redirectUrl,
      failure: params.redirectUrl,
    },
    auto_return: 'approved',
    ...(params.correoDelCliente ? { payer: { email: params.correoDelCliente } } : {}),
  };

  const r = await fetch(`${API}/checkout/preferences`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;

  const datos = (await r.json()) as {
    id?: string | number;
    init_point?: string;
    sandbox_init_point?: string;
  };
  // En pruebas hay que mandar al cliente al init_point de sandbox; el de
  // produccion con credenciales de prueba devuelve un error de su lado.
  const url =
    params.entorno === 'SANDBOX'
      ? datos.sandbox_init_point ?? datos.init_point
      : datos.init_point;
  if (!url || datos.id === undefined) return null;

  return { url, preferenceId: String(datos.id) };
}

/** Relee el pago contra la API de Mercado Pago. Es la fuente del estado. */
export async function leerPago(
  accessToken: string,
  paymentId: string,
): Promise<PagoDeMercadoPago | null> {
  const r = await fetch(`${API}/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;

  const p = (await r.json()) as {
    id?: string | number;
    status?: string;
    external_reference?: string | null;
    transaction_amount?: number;
    subscription_id?: string | null;
    metadata?: { preapproval_id?: string | null } | null;
    point_of_interaction?: { transaction_data?: { subscription_id?: string | null } } | null;
  };
  if (!p.status) return null;

  return {
    id: String(p.id ?? paymentId),
    estado: aEstadoDePago(p.status),
    estadoCrudo: p.status,
    referencia: p.external_reference ?? null,
    monto: Number(p.transaction_amount ?? 0),
    // El cobro recurrente NO trae el mandato en `subscription_id` de la raiz:
    // viene en point_of_interaction.transaction_data y en metadata. Leer solo
    // la raiz hacia que el cobro mensual pareciera un pago suelto y se
    // descartara en silencio. Quien conoce el mandato por otra via (el
    // authorized_payment) lo pasa como pista.
    preapprovalId:
      p.subscription_id ||
      p.point_of_interaction?.transaction_data?.subscription_id ||
      p.metadata?.preapproval_id ||
      null,
    crudo: p,
  };
}

// ── Cobro automatico (preapproval) ──────────────────────────────────────────
//
// El anfitrion autoriza UNA vez y Mercado Pago cobra cada periodo. Hay tres
// recursos distintos y se confunden facil:
//
//   preapproval          — el mandato: monto, periodicidad y estado.
//   authorized_payment   — un intento de cobro de ese mandato (una "factura").
//   payment              — el pago real, que existe cuando el cobro se intenta.
//
// El webhook `subscription_authorized_payment` trae el id de un
// authorized_payment, no el de un pago: pasarselo a /v1/payments devuelve 404.
// Hay que resolverlo primero.

export type EstadoDeMandato = 'pending' | 'authorized' | 'paused' | 'cancelled';

export type MandatoDeMercadoPago = {
  id: string;
  estado: EstadoDeMandato;
  /** Lo que mandamos al crearlo: el id de nuestra empresa. */
  referencia: string | null;
  initPoint: string | null;
  crudo: unknown;
};

function aMandato(m: {
  id?: string | number;
  status?: string;
  external_reference?: string | null;
  init_point?: string | null;
}): MandatoDeMercadoPago | null {
  if (m.id === undefined || !m.status) return null;
  const conocidos: string[] = ['pending', 'authorized', 'paused', 'cancelled'];
  return {
    id: String(m.id),
    // Cualquier estado raro se trata como pendiente: nunca como autorizado.
    estado: conocidos.includes(m.status) ? (m.status as EstadoDeMandato) : 'pending',
    referencia: m.external_reference ?? null,
    initPoint: m.init_point ?? null,
    crudo: m,
  };
}

/**
 * Crea el mandato sin tarjeta: queda `pending` y devuelve la URL donde el
 * anfitrion pone la suya y autoriza. El primer cobro lo hace Mercado Pago al
 * autorizar.
 *
 * El periodo es de 30 DIAS y no de un mes calendario, a proposito: cada pago
 * compra exactamente 30 dias (`DIAS_POR_PAGO`), y con meses el cobro y los dias
 * comprados se irian desfasando.
 *
 * `external_reference` es el id de la empresa y nada mas: Mercado Pago
 * modera ese campo y rechaza correos u otros datos personales
 * (invalid_field_content).
 */
export async function crearMandato(params: {
  accessToken: string;
  motivo: string;
  monto: number;
  dias: number;
  referencia: string;
  correoDelPagador: string;
  notificationUrl: string;
  redirectUrl: string;
}): Promise<MandatoDeMercadoPago | { error: string }> {
  const r = await fetch(`${API}/preapproval`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      reason: params.motivo,
      external_reference: params.referencia,
      payer_email: params.correoDelPagador,
      back_url: params.redirectUrl,
      notification_url: params.notificationUrl,
      status: 'pending',
      auto_recurring: {
        frequency: params.dias,
        frequency_type: 'days',
        transaction_amount: params.monto,
        currency_id: 'COP',
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  const cuerpo = (await r.json().catch(() => ({}))) as { message?: string };
  if (!r.ok) return { error: cuerpo.message ?? `Mercado Pago respondio ${r.status}` };
  return (
    aMandato(cuerpo as Parameters<typeof aMandato>[0]) ?? { error: 'Respuesta de Mercado Pago sin id' }
  );
}

export async function leerMandato(
  accessToken: string,
  id: string,
): Promise<MandatoDeMercadoPago | null> {
  const r = await fetch(`${API}/preapproval/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  return aMandato((await r.json()) as Parameters<typeof aMandato>[0]);
}

/** Pausa, reanuda o cancela el cobro automatico. Cancelar no tiene vuelta. */
export async function cambiarEstadoDeMandato(
  accessToken: string,
  id: string,
  estado: 'cancelled' | 'paused' | 'authorized',
): Promise<boolean> {
  const r = await fetch(`${API}/preapproval/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ status: estado }),
    signal: AbortSignal.timeout(8000),
  });
  return r.ok;
}

/**
 * Resuelve un authorized_payment al mandato y al pago real.
 *
 * `pagoId` es null mientras el cobro esta programado o reintentandose: aun no
 * hay pago del que hablar y no es un error.
 */
export async function leerCobroAutorizado(
  accessToken: string,
  id: string,
): Promise<{ mandatoId: string | null; pagoId: string | null } | null> {
  const r = await fetch(`${API}/authorized_payments/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;
  const c = (await r.json()) as {
    preapproval_id?: string | number | null;
    payment?: { id?: string | number | null } | null;
  };
  return {
    mandatoId: c.preapproval_id ? String(c.preapproval_id) : null,
    pagoId: c.payment?.id ? String(c.payment.id) : null,
  };
}

/**
 * Valida la cabecera `x-signature` de una notificacion.
 *
 *   HMAC-SHA256("id:<data.id>;request-id:<x-request-id>;ts:<ts>;", secreto)
 *
 * No es lo que impide que nos mientan —para eso esta releer el pago— sino lo
 * que evita que un tercero nos haga consultar su API a voluntad. Por eso solo
 * se exige cuando el anfitrion guardo el secreto: sin el, el cobro sigue
 * funcionando igual de bien.
 */
export function firmaValida(params: {
  xSignature: string | undefined;
  xRequestId: string | undefined;
  dataId: string;
  secreto: string;
}): boolean {
  const { xSignature, xRequestId, dataId, secreto } = params;
  if (!xSignature) return false;

  const partes = Object.fromEntries(
    xSignature.split(',').map((p) => {
      const [k, ...resto] = p.split('=');
      return [k?.trim(), resto.join('=').trim()];
    }),
  ) as { ts?: string; v1?: string };
  if (!partes.ts || !partes.v1) return false;

  const manifiesto = `id:${dataId};request-id:${xRequestId ?? ''};ts:${partes.ts};`;
  const calculado = createHmac('sha256', secreto).update(manifiesto).digest('hex');

  const a = Buffer.from(calculado, 'utf8');
  const b = Buffer.from(partes.v1.toLowerCase(), 'utf8');
  // Comparacion de tiempo constante: comparar firmas con === filtra el
  // prefijo correcto byte a byte.
  return a.length === b.length && timingSafeEqual(a, b);
}
