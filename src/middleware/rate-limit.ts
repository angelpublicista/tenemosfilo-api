// Limites de peticiones.
//
// Tres razones distintas para limitar, y por eso tres limitadores:
//
//   1. Que una integracion mal hecha no tumbe el API para todos.
//   2. Que nadie pruebe contraseñas a lo bruto contra /auth.
//   3. Que el catalogo publico, que no pide credenciales, no sea una via
//      libre para inundar la base de reservas basura.
//
// El contador vive en memoria del proceso. Con una sola instancia es
// exacto; el dia que haya varias, cada una contara por su cuenta y el
// limite real sera N veces mayor. Para eso hara falta un store compartido
// (Redis), pero no vamos a montar esa pieza antes de necesitarla.
import { createHash } from 'node:crypto';
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { isApiKeyToken } from '../lib/api-key.js';
import { logger } from '../lib/logger.js';

const MINUTO = 60 * 1000;

/**
 * A quien se le cuenta la peticion.
 *
 * Por credencial antes que por IP: varias integraciones pueden salir por la
 * misma IP (una oficina, un proveedor cloud) y no tienen por que gastarse
 * el cupo entre ellas.
 *
 * Se identifica por el token en bruto, no por `req.apiKey`, porque el
 * limitador corre ANTES de `requireAuth` — si esperara a la sesion, todas
 * las peticiones caerian en el contador de la IP y dos integraciones
 * distintas compartirian cupo. No hace falta validar el token para contar:
 * basta con que dos peticiones de la misma credencial caigan en el mismo
 * cubo. Se hashea para no tener credenciales en memoria ni en los logs.
 */
function porCredencial(req: Request): string {
  // Si el limitador se monta despues de autenticar, se usa la identidad ya
  // resuelta: es mas legible en los logs.
  if (req.apiKey) return `key:${req.apiKey.id}`;
  if (req.user) return `user:${req.user.id}`;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return `tok:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
  }

  // Por IP, y agrupando IPv6 por prefijo en vez de por direccion exacta.
  //
  // A un cliente IPv6 el proveedor le asigna un bloque entero: puede cambiar
  // de direccion en cada peticion sin cambiar de red. Contar por direccion
  // completa haria que el limite no limitara nada. ipKeyGenerator normaliza
  // al prefijo, que es lo que de verdad identifica a quien llama.
  if (!req.ip) return 'ip:desconocida';
  return `ip:${ipKeyGenerator(req.ip)}`;
}

/** Respuesta 429 con el mismo formato de error que el resto del API. */
function responder(mensaje: string) {
  return (req: Request, res: Response) => {
    logger.warn(
      { quien: porCredencial(req), ruta: req.originalUrl, metodo: req.method },
      'limite de peticiones alcanzado',
    );
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: mensaje },
    });
  };
}

const comunes = {
  // Se emiten los dos formatos a proposito:
  //
  //   RateLimit: limit=120, remaining=119, reset=60   (draft-7 del IETF)
  //   X-RateLimit-Limit / -Remaining / -Reset          (el de toda la vida)
  //
  // El estandar manda los tres datos en una sola cabecera, que es mas
  // limpio pero casi ningun cliente sabe parsear todavia; las X-RateLimit
  // separadas son las que leen de hecho las librerias existentes. Cuestan
  // tres cabeceras y evitan que quien se integre tenga que provocar un 429
  // para saber cuanto le queda.
  standardHeaders: 'draft-7',
  legacyHeaders: true,
} satisfies Partial<Options>;

/**
 * Limite general del API autenticado.
 *
 * Generoso a proposito: aqui no se trata de racionar, sino de que un bucle
 * infinito en el cliente de alguien no se lleve el servicio por delante.
 */
export const limiteGeneral = rateLimit({
  ...comunes,
  windowMs: MINUTO,
  limit: 300,
  keyGenerator: porCredencial,
  handler: responder('Demasiadas peticiones. Espera un momento y reintenta.'),
});

/**
 * Endpoints de credenciales.
 *
 * Estricto y por IP: contar por usuario seria inutil, porque quien prueba
 * contraseñas va cambiando el email en cada intento.
 */
export const limiteAuth = rateLimit({
  ...comunes,
  windowMs: 15 * MINUTO,
  limit: 10,
  // Un login correcto no gasta cupo: el limite es para quien falla una y
  // otra vez, no para quien usa la aplicacion con normalidad.
  skipSuccessfulRequests: true,
  handler: responder('Demasiados intentos. Espera unos minutos e intentalo de nuevo.'),
});

/**
 * Catalogo publico: sin credenciales, asi que solo queda la IP.
 *
 * Holgado porque una sola visita dispara varias peticiones (catalogo,
 * politica de iframe, disponibilidad) y porque detras de una IP puede haber
 * una oficina entera.
 */
export const limitePublico = rateLimit({
  ...comunes,
  windowMs: MINUTO,
  limit: 120,
  handler: responder('Demasiadas peticiones. Espera un momento y recarga la pagina.'),
});

/**
 * Alta de reservas sin sesion.
 *
 * Mas apretado que el resto del catalogo: cada peticion que pasa crea una
 * fila en la base y puede disparar un cobro. Aun asi deja margen para que
 * alguien se equivoque, corrija y reintente.
 */
export const limiteReservaPublica = rateLimit({
  ...comunes,
  windowMs: 10 * MINUTO,
  limit: 15,
  handler: responder('Has creado demasiadas reservas seguidas. Espera unos minutos.'),
});

/**
 * Red de seguridad contra el sondeo de API keys.
 *
 * Solo mira peticiones cuyo token tiene forma de API key, y solo cuenta las
 * que fallan. Las dos condiciones importan:
 *
 * - Solo API keys, porque son las unicas que consultan la base antes de
 *   rechazar; un JWT falso se cae en la verificacion de firma, sin tocar
 *   Postgres. Ademas el front llama al API desde su propio servidor, asi
 *   que todos sus usuarios comparten una IP: si sus 401 por sesion caducada
 *   contaran aqui, un pico de sesiones expiradas dejaria fuera a todos.
 * - Solo fallos, porque el uso normal de una API key no es sospechoso por
 *   mucho que se repita; para eso esta el limite por credencial.
 *
 * Al superarse, se bloquea todo lo que venga de esa IP con forma de API
 * key durante el resto del minuto: quien esta probando llaves a ver cual
 * cuela no tiene por que seguir intentandolo.
 */
export const limiteSondeoDeKeys = rateLimit({
  ...comunes,
  windowMs: MINUTO,
  limit: 60,
  skipSuccessfulRequests: true,
  skip: (req) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;
    return !isApiKeyToken(header.slice('Bearer '.length).trim());
  },
  handler: responder('Demasiadas credenciales rechazadas desde esta conexion. Espera un momento.'),
});
