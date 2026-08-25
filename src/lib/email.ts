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
};

/**
 * Envia un correo. Devuelve true si ZeptoMail lo acepto.
 *
 * No lanza: el caller decide que hacer. En el flujo de recuperacion de
 * contraseña un fallo de correo NO debe cambiar la respuesta HTTP, porque
 * eso delataria si el email existe o no.
 */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<boolean> {
  if (!env.ZEPTOMAIL_TOKEN || !env.ZEPTOMAIL_FROM_EMAIL) {
    logger.error('ZEPTOMAIL_TOKEN o ZEPTOMAIL_FROM_EMAIL sin configurar: no se envio el correo');
    return false;
  }

  try {
    const res = await fetch(env.ZEPTOMAIL_API_URL, {
      method: 'POST',
      headers: {
        Authorization: cabeceraDeAutorizacion(env.ZEPTOMAIL_TOKEN),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from: { address: env.ZEPTOMAIL_FROM_EMAIL, name: env.ZEPTOMAIL_FROM_NAME },
        // ZeptoMail anida el destinatario un nivel mas que otros proveedores:
        // to[].email_address.address, no to[].email.
        to: [{ email_address: { address: to } }],
        subject,
        htmlbody: html,
      }),
    });

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

/** Plantilla del correo de recuperacion de contraseña. */
export function passwordResetEmailHtml(resetUrl: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head><meta charset="utf-8" /></head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background-color: #f26726; color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0;">Recuperar contraseña</h1>
          </div>
          <div style="padding: 30px; background-color: #f9f9f9;">
            <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta.</p>
            <p>Haz clic en el boton para elegir una contraseña nueva:</p>
            <p style="text-align: center;">
              <a href="${resetUrl}"
                 style="display: inline-block; background-color: #f26726; color: white;
                        padding: 12px 24px; text-decoration: none; border-radius: 5px; margin: 20px 0;">
                Cambiar mi contraseña
              </a>
            </p>
            <p style="font-size: 13px; color: #666;">
              El enlace caduca en 1 hora y solo puede usarse una vez.
            </p>
            <p style="font-size: 13px; color: #666;">
              Si no solicitaste este cambio, ignora este correo: tu contraseña seguira igual.
            </p>
          </div>
          <div style="text-align: center; padding: 20px; color: #666; font-size: 12px;">
            <p>Este correo fue enviado desde Tenemos Filo</p>
          </div>
        </div>
      </body>
    </html>
  `;
}
