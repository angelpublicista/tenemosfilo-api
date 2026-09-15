// Verificacion de reCAPTCHA contra Google.
//
// Hasta ahora el widget se pintaba en el registro pero nadie comprobaba la
// respuesta: el front miraba que hubiera token antes de enviar y ya. Esa
// comprobacion vive en el navegador, asi que se la salta cualquiera llamando
// al API directamente, que es justo lo que hace un bot. El widget decoraba.
//
// La clave secreta va aqui y nunca en el front: todo lo que el front expone
// como NEXT_PUBLIC_ viaja dentro del JavaScript que descarga el navegador.
import { env } from '../config/env.js';
import { logger } from './logger.js';

const URL_VERIFICACION = 'https://www.google.com/recaptcha/api/siteverify';

/** Si Google no contesta en este tiempo, no bloqueamos el registro. */
const TIMEOUT_MS = 5000;

export interface ResultadoRecaptcha {
  valido: boolean;
  /** Por que no valia, para el log. Nunca se le enseña a quien se registra. */
  motivo?: string;
}

/** Esta configurada la verificacion? */
export const recaptchaActivo = (): boolean => Boolean(env.RECAPTCHA_SECRET_KEY);

/**
 * Comprueba un token contra Google.
 *
 * Sin `RECAPTCHA_SECRET_KEY` devuelve valido: el API tiene que poder
 * levantarse y registrar gente aunque la clave no este puesta todavia. Que
 * esta apagado se avisa al arrancar, no en cada registro.
 *
 * Si Google no responde o falla la red, tambien deja pasar. Es una decision
 * consciente: entre dejar entrar a algun bot y dejar fuera a todo el mundo
 * porque un tercero se cayo, preferimos lo primero. Queda en el log.
 */
export async function verificarRecaptcha(
  token: string | undefined,
  ip?: string,
): Promise<ResultadoRecaptcha> {
  if (!recaptchaActivo()) return { valido: true };

  if (!token) return { valido: false, motivo: 'sin token' };

  const cuerpo = new URLSearchParams({
    secret: env.RECAPTCHA_SECRET_KEY,
    response: token,
  });
  // Google la usa como señal extra; si no la tenemos, no pasa nada.
  if (ip) cuerpo.set('remoteip', ip);

  try {
    const res = await fetch(URL_VERIFICACION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      logger.warn({ status: res.status }, 'reCAPTCHA: Google respondio con error');
      return { valido: true, motivo: `http ${res.status}` };
    }

    const datos = (await res.json()) as {
      success?: boolean;
      'error-codes'?: string[];
    };

    if (datos.success) return { valido: true };

    const codigos = datos['error-codes'] ?? [];
    // Un secreto mal puesto es un fallo de configuracion nuestro, no un bot:
    // si no se distingue, se ve como una oleada de registros rechazados.
    if (codigos.includes('invalid-input-secret') || codigos.includes('missing-input-secret')) {
      logger.error({ codigos }, 'reCAPTCHA: la clave secreta no es valida. Revisa RECAPTCHA_SECRET_KEY');
      return { valido: true, motivo: 'secreto mal configurado' };
    }

    return { valido: false, motivo: codigos.join(', ') || 'rechazado por Google' };
  } catch (err) {
    // Timeout o red: no bloqueamos.
    logger.warn({ err }, 'reCAPTCHA: no se pudo verificar, se deja pasar');
    return { valido: true, motivo: 'no se pudo verificar' };
  }
}
