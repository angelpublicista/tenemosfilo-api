// Envio de correo transaccional via la API REST de Brevo.
//
// Usamos fetch (global desde Node 18) en vez de SMTP para no agregar
// dependencias: el API solo necesita disparar correos puntuales.
import { env } from '../config/env.js';
import { logger } from './logger.js';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Envia un correo. Devuelve true si Brevo lo acepto.
 *
 * No lanza: el caller decide que hacer. En el flujo de recuperacion de
 * contraseña un fallo de correo NO debe cambiar la respuesta HTTP, porque
 * eso delataria si el email existe o no.
 */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<boolean> {
  if (!env.BREVO_API_KEY || !env.BREVO_FROM_EMAIL) {
    logger.error('BREVO_API_KEY o BREVO_FROM_EMAIL sin configurar: no se envio el correo');
    return false;
  }

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: env.BREVO_FROM_EMAIL, name: 'Tenemos Filo' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body }, 'Brevo rechazo el envio de correo');
      return false;
    }
    return true;
  } catch (err) {
    logger.error({ err }, 'Error de red enviando correo por Brevo');
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
