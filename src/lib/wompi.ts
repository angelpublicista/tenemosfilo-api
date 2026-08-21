// Integracion con Wompi (pasarela de pagos).
//
// Los dos algoritmos vienen de la documentacion oficial y son SHA256 plano,
// NO HMAC:
//   docs.wompi.co/en/docs/colombia/widget-checkout-web/
//   docs.wompi.co/en/docs/colombia/eventos/
import { createHash } from 'node:crypto';

/** Wompi trabaja en centavos; el peso colombiano no usa decimales. */
export function aCentavos(montoEnPesos: number): number {
  return Math.round(montoEnPesos * 100);
}

/**
 * Firma de integridad del checkout.
 *
 *   SHA256(referencia + montoEnCentavos + moneda [+ expiracion] + secreto)
 *
 * Se calcula SIEMPRE en el servidor: el secreto de integridad no puede
 * llegar al navegador, o cualquiera podria firmar pagos por el importe que
 * quisiera.
 */
export function firmaIntegridad(params: {
  reference: string;
  amountInCents: number;
  currency: string;
  integritySecret: string;
  /** ISO 8601, opcional. Si se manda, entra en la firma. */
  expirationTime?: string;
}): string {
  const { reference, amountInCents, currency, integritySecret, expirationTime } = params;
  const cadena = expirationTime
    ? `${reference}${amountInCents}${currency}${expirationTime}${integritySecret}`
    : `${reference}${amountInCents}${currency}${integritySecret}`;
  return createHash('sha256').update(cadena).digest('hex');
}

type EventoWompi = {
  event?: string;
  data?: Record<string, unknown>;
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number | string;
  sent_at?: string;
};

/** Lee "transaction.status" dentro de data siguiendo el camino por puntos. */
function valorPorRuta(objeto: Record<string, unknown>, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((acc, parte) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[parte];
    return undefined;
  }, objeto);
}

/**
 * Valida el checksum de un webhook.
 *
 *   SHA256(valores de signature.properties + timestamp + secreto de eventos)
 *
 * Sin esto, el endpoint publico del webhook aceptaria que cualquiera
 * marcara reservas como pagadas.
 */
export function webhookValido(evento: EventoWompi, eventsSecret: string): boolean {
  const propiedades = evento.signature?.properties;
  const checksum = evento.signature?.checksum;
  if (!Array.isArray(propiedades) || !checksum || !evento.data) return false;

  const concatenado = propiedades
    .map((ruta) => {
      const v = valorPorRuta(evento.data as Record<string, unknown>, ruta);
      return v === undefined || v === null ? '' : String(v);
    })
    .join('');

  const calculado = createHash('sha256')
    .update(`${concatenado}${evento.timestamp ?? ''}${eventsSecret}`)
    .digest('hex');

  // Comparacion insensible a mayusculas: Wompi documenta hex en minuscula,
  // pero no cuesta nada no depender de ello.
  return calculado.toLowerCase() === String(checksum).toLowerCase();
}

/** Estados de transaccion de Wompi mapeados a los nuestros. */
export function aEstadoDePago(estadoWompi: string): 'PAID' | 'FAILED' | 'PENDING' {
  switch (estadoWompi) {
    case 'APPROVED':
      return 'PAID';
    case 'DECLINED':
    case 'ERROR':
    case 'VOIDED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/** URL del checkout web. Wompi distingue el entorno por la llave, no por host. */
export const URL_CHECKOUT = 'https://checkout.wompi.co/p/';

/**
 * Las llaves de Wompi llevan el entorno en el prefijo (pub_test_ / pub_prod_).
 * Cruzar una llave de pruebas con el entorno de produccion es un error facil
 * de cometer y dificil de diagnosticar: los pagos simplemente no entran.
 */
export function llaveCoincideConEntorno(
  llave: string | null | undefined,
  entorno: 'SANDBOX' | 'PRODUCTION',
): boolean {
  if (!llave) return true; // sin llave no hay nada que validar
  const esDePruebas = llave.includes('_test_');
  const esDeProduccion = llave.includes('_prod_');
  if (!esDePruebas && !esDeProduccion) return true; // formato desconocido
  return entorno === 'PRODUCTION' ? esDeProduccion : esDePruebas;
}
