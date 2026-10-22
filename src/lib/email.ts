// Envio de correo transaccional via la API REST de ZeptoMail (Zoho).
//
// Usamos fetch (global desde Node 18) en vez del SDK oficial o de SMTP para
// no agregar dependencias: el API solo necesita disparar correos puntuales.
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * El token tal como lo espera la cabecera.
 *
 * La consola de ZeptoMail muestra el "Send Mail Token" a veces suelto y a
 * veces ya con el prefijo pegado. Si alguien copia la linea completa y aqui
 * volvemos a anteponerlo, sale un 401 que no dice nada util. Se normaliza
 * una vez, al arrancar.
 */
const PREFIJO = 'Zoho-enczapikey';

function cabeceraDeAutorizacion(token: string): string {
  const limpio = token.trim();
  return limpio.toLowerCase().startsWith(PREFIJO.toLowerCase())
    ? limpio
    : `${PREFIJO} ${limpio}`;
}

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  /** Nombre visible del remitente; la direccion sigue siendo la verificada. */
  fromName?: string;
  /** A donde llegan las respuestas del destinatario. */
  replyTo?: string;
};

/**
 * Envia un correo. Devuelve true si ZeptoMail lo acepto.
 *
 * No lanza: el caller decide que hacer. En el flujo de recuperacion de
 * contraseña un fallo de correo NO debe cambiar la respuesta HTTP, porque
 * eso delataria si el email existe o no.
 */
export async function sendEmail({
  to,
  subject,
  html,
  fromName,
  replyTo,
}: SendEmailInput): Promise<boolean> {
  if (!env.ZEPTOMAIL_TOKEN || !env.ZEPTOMAIL_FROM_EMAIL) {
    logger.error('ZEPTOMAIL_TOKEN o ZEPTOMAIL_FROM_EMAIL sin configurar: no se envio el correo');
    return false;
  }

  const enviar = (conReplyTo: boolean) =>
    fetch(env.ZEPTOMAIL_API_URL, {
      method: 'POST',
      headers: {
        Authorization: cabeceraDeAutorizacion(env.ZEPTOMAIL_TOKEN),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from: { address: env.ZEPTOMAIL_FROM_EMAIL, name: fromName ?? env.ZEPTOMAIL_FROM_NAME },
        // ZeptoMail anida el destinatario un nivel mas que otros proveedores:
        // to[].email_address.address, no to[].email.
        to: [{ email_address: { address: to } }],
        ...(conReplyTo && replyTo ? { reply_to: [{ address: replyTo }] } : {}),
        subject,
        htmlbody: html,
      }),
    });

  try {
    let res = await enviar(true);

    // ZeptoMail pide que el Reply-To sea de un dominio verificado en la cuenta,
    // y el correo de un anfitrion (un gmail, por ejemplo) no lo es. Perder el
    // Reply-To es molesto; perder el correo de la reserva, no. Se reintenta
    // sin el.
    if (!res.ok && replyTo) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body, replyTo }, 'ZeptoMail rechazo el Reply-To: se reenvia sin el');
      res = await enviar(false);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, 'ZeptoMail rechazo el envio de correo');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Error de red enviando correo por ZeptoMail');
    return false;
  }
}
