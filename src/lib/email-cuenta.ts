// Correos de la cuenta: lo que se le escribe a alguien por registrarse.
//
// Los textos viven en lib/plantillas-de-correo.ts, donde el administrador puede
// editarlos; aquí solo se decide a quién se le manda cuál y con qué valores.
import type { UserRole } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { sendEmail } from './email.js';
import { armarCorreo } from './plantillas-de-correo.js';

/**
 * Envía la bienvenida sin que un fallo de correo afecte al registro: la cuenta
 * ya existe y eso es lo que importa. `sendEmail` no lanza; el catch es por si
 * falla la lectura de la plantilla.
 *
 * Al anfitrión se le cuenta lo que sigue, porque tras crear la cuenta le toca
 * registrar su empresa y, si la plataforma lo exige, activar la suscripción: sin
 * eso el panel no le sirve.
 */
export async function enviarBienvenida(usuario: {
  email: string;
  name: string | null;
  role: UserRole;
}): Promise<void> {
  try {
    const nombre = usuario.name?.trim();
    const { subject, html } = await armarCorreo(
      usuario.role === 'HOST' ? 'bienvenida_anfitrion' : 'bienvenida',
      {
        saludo: nombre ? `Hola ${nombre},` : 'Hola,',
        enlace_ayuda: `${env.APP_URL}/dashboard/ayuda`,
      },
    );
    await sendEmail({ to: usuario.email, subject, html });
  } catch (err) {
    logger.error({ err, email: usuario.email }, 'No se pudo enviar el correo de bienvenida');
  }
}
