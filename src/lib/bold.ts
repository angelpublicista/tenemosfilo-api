// Integracion con Bold (API de link de pagos).
//
// Se parece a Mercado Pago en la ida y a Wompi en la vuelta:
//
//   Para cobrar   — el servidor crea un link de pago contra su API y recibe
//                   una URL; el navegador solo va a esa URL.
//   Para enterarse — Bold manda el estado dentro del evento, firmado con la
//                   llave secreta del comercio. No hay un pago que releer con
//                   una sola llamada, asi que aqui la firma SI es lo que
//                   impide que nos mientan, y por eso es obligatoria.
//
// Dos cosas de Bold que no se parecen a ninguna de las otras:
//
//   - El webhook se configura en su panel y es de TODA la cuenta: llegan
//     tambien las ventas del datafono y los links que el anfitrion cree a
//     mano. Lo que no lleva un numero de reserva nuestro no es un error.
//   - La llave de identidad basta para crear links. La secreta solo firma.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/** Se puede apuntar a otro host en pruebas; por defecto, el de verdad. */
const API = env.BOLD_API_URL ?? 'https://integrations.api.bold.co';

export type EstadoDeBold = 'PAID' | 'FAILED' | 'REFUNDED';

/**
 * Tipos de evento de Bold mapeados a nuestros estados.
 *
 * `VOID_REJECTED` es una anulacion que NO se hizo: el dinero sigue cobrado y
 * no hay nada que cambiar. Devuelve null, igual que cualquier tipo que no
 * conozcamos.
 */
export function aEstadoDePago(tipo: string): EstadoDeBold | null {
  switch (tipo) {
    case 'SALE_APPROVED':
      return 'PAID';
    case 'SALE_REJECTED':
      return 'FAILED';
    case 'VOID_APPROVED':
      return 'REFUNDED';
    default:
      return null;
  }
}

export type LinkCreado = { url: string; linkId: string };

/**
 * Crea el link de pago y devuelve a donde hay que mandar al cliente.
 *
 * El monto va en pesos, no en centavos, y cerrado (`CLOSE`): el cliente no
 * puede cambiarlo. No se manda fecha de vencimiento: su documentacion se
 * contradice en la unidad, y un link que no vence es mejor que uno que vence
 * en 1970.
 */
export async function crearLinkDePago(params: {
  llaveDeIdentidad: string;
  descripcion: string;
  monto: number;
  referencia: string;
  redirectUrl: string;
  correoDelCliente?: string | null;
}): Promise<LinkCreado | null> {
  const cuerpo = {
    amount_type: 'CLOSE',
    amount: {
      currency: 'COP',
      total_amount: Math.round(params.monto),
      tip_amount: 0,
    },
    reference: params.referencia,
    // Entre 2 y 100 caracteres.
    description: params.descripcion.slice(0, 100).padEnd(2, '.'),
    // Solo admite https: en local, con http, se omite y el cliente se queda
    // en la pagina de Bold al terminar.
    ...(params.redirectUrl.startsWith('https://') ? { callback_url: params.redirectUrl } : {}),
    ...(params.correoDelCliente ? { payer_email: params.correoDelCliente } : {}),
  };

  const r = await fetch(`${API}/online/link/v1`, {
    method: 'POST',
    headers: {
      authorization: `x-api-key ${params.llaveDeIdentidad}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) return null;

  const datos = (await r.json()) as { payload?: { payment_link?: string; url?: string } };
  const url = datos.payload?.url;
  const linkId = datos.payload?.payment_link;
  if (!url || !linkId) return null;

  return { url, linkId };
}

/**
 * Valida la cabecera `x-bold-signature` de una notificacion.
 *
 *   HMAC-SHA256(base64(cuerpo crudo), llave secreta) en hexadecimal
 *
 * Se firma sobre los bytes exactos que llegaron: volver a serializar el json
 * cambia espacios y la firma deja de cuadrar.
 *
 * En modo pruebas Bold firma con una cadena vacia, no con la llave secreta de
 * pruebas. Por eso en SANDBOX se aceptan las dos: cualquiera puede calcular
 * la de la cadena vacia, pero ahi no hay dinero de verdad.
 */
export function firmaValida(params: {
  firma: string | undefined;
  cuerpoCrudo: Buffer | undefined;
  llaveSecreta: string;
  entorno: 'SANDBOX' | 'PRODUCTION';
}): boolean {
  const { firma, cuerpoCrudo, llaveSecreta, entorno } = params;
  if (!firma || !cuerpoCrudo) return false;

  const codificado = cuerpoCrudo.toString('base64');
  const recibida = Buffer.from(firma.trim().toLowerCase(), 'utf8');
  const llaves = entorno === 'SANDBOX' ? [llaveSecreta, ''] : [llaveSecreta];

  return llaves.some((llave) => {
    const calculada = Buffer.from(
      createHmac('sha256', llave).update(codificado).digest('hex'),
      'utf8',
    );
    // Comparacion de tiempo constante: comparar firmas con === filtra el
    // prefijo correcto byte a byte.
    return calculada.length === recibida.length && timingSafeEqual(calculada, recibida);
  });
}
