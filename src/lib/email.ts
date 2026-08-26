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

/**
 * Plantilla de la invitacion a una cuenta creada por un administrador.
 *
 * No lleva contraseña: el enlace deja que la persona elija la suya. Mandarle
 * una que eligio otro significaria que dos personas la conocen y que queda
 * escrita para siempre en dos buzones.
 */
export function invitationEmailHtml(inviteUrl: string, nombre?: string | null): string {
  const saludo = nombre ? `Hola ${escaparHtml(nombre)},` : 'Hola,';
  return `
    <!DOCTYPE html>
    <html lang="es">
      <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style="margin:0;padding:0;background-color:#f3f4f6;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
               style="background-color:#f3f4f6;padding:24px 12px;">
          <tr><td align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" width="600"
                   style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;
                          overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
              <tr>
                <td style="background-color:#F26726;padding:28px 32px;">
                  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">
                    Tu cuenta está lista
                  </h1>
                </td>
              </tr>
              <tr>
                <td style="padding:32px;color:#374151;font-size:15px;line-height:1.6;">
                  <p style="margin:0 0 16px;">${saludo}</p>
                  <p style="margin:0 0 16px;">
                    Te crearon una cuenta en <strong>Tenemos Filo</strong>. Solo falta que
                    elijas tu contraseña para entrar.
                  </p>
                  <p style="text-align:center;margin:28px 0 8px;">
                    <a href="${escaparHtml(inviteUrl)}"
                       style="display:inline-block;background-color:#F26726;color:#ffffff;
                              padding:13px 28px;text-decoration:none;border-radius:6px;
                              font-weight:600;font-size:15px;">
                      Elegir mi contraseña
                    </a>
                  </p>
                  <p style="font-size:13px;color:#6b7280;margin:24px 0 0;">
                    El enlace caduca en 7 días y solo puede usarse una vez. Si caduca,
                    pide uno nuevo desde "¿Olvidaste tu contraseña?" en la pantalla de acceso.
                  </p>
                  <p style="font-size:13px;color:#6b7280;margin:12px 0 0;">
                    Si no esperabas este correo, puedes ignorarlo: sin elegir contraseña,
                    la cuenta no se puede usar.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:20px 32px;background-color:#f9fafb;color:#9ca3af;
                           font-size:12px;text-align:center;">
                  Tenemos Filo · experiencias gastronómicas
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </body>
    </html>
  `;
}

/** El nombre lo teclea un administrador, pero acaba en el correo de otro. */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
