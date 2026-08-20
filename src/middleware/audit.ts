// Registro de auditoria: una fila por mutacion con exito.
//
// Va como middleware global en vez de repartido por los servicios para que
// ningun modulo pueda "olvidarse" de auditar, incluidos los que se agreguen
// despues. El precio es que el detalle es a nivel de peticion (ruta, body)
// y no del cambio campo a campo.
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { logger } from '../lib/logger.js';

const METODOS_AUDITADOS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// Nunca deben acabar en la BD de auditoria.
const CLAVES_SECRETAS = [
  'password',
  'newpassword',
  'currentpassword',
  'token',
  'idtoken',
  'accesstoken',
  'refreshtoken',
  'secret',
  'apikey',
  'authorization',
];

const MAX_PAYLOAD_CHARS = 4000;

function esSecreta(clave: string): boolean {
  const k = clave.toLowerCase();
  return CLAVES_SECRETAS.some((s) => k.includes(s));
}

/** Copia el body sustituyendo cualquier valor sensible por [REDACTADO]. */
function redactar(valor: unknown, profundidad = 0): unknown {
  if (profundidad > 5 || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((v) => redactar(v, profundidad + 1));

  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    salida[k] = esSecreta(k) ? '[REDACTADO]' : redactar(v, profundidad + 1);
  }
  return salida;
}

function accionDe(method: string): string {
  if (method === 'POST') return 'CREATE';
  if (method === 'DELETE') return 'DELETE';
  return 'UPDATE';
}

/**
 * Correo al que atribuir el registro.
 *
 * En /auth/login y /auth/register no hay usuario autenticado todavia, asi
 * que sin esto quedarian como "Sistema". El correo viene del propio body;
 * la contraseña ya fue redactada antes de llegar aqui.
 */
function correoDe(req: Request): string | null {
  if (req.user?.email) return req.user.email;
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email : null;
}

/**
 * Tipo de recurso a partir de la ruta: /experiences/abc/status -> experiences.
 * Usamos originalUrl porque req.path dentro de un Router viene recortado.
 */
function partesDe(url: string): string[] {
  return (url.split('?')[0] ?? '').split('/').filter(Boolean);
}

function recursoDe(url: string): string {
  return partesDe(url)[0] ?? 'desconocido';
}

/**
 * Id del recurso tocado.
 *
 * En PATCH/DELETE viene en la ruta (/experiences/abc, /experiences/abc/status).
 * En POST no existe todavia, asi que lo tomamos de la respuesta: no se puede
 * leer de req.params porque Express ya los restauro cuando salta 'finish'.
 */
function idDe(url: string, idDeRespuesta: string | null): string | null {
  if (idDeRespuesta) return idDeRespuesta;
  const partes = partesDe(url);
  return partes.length >= 2 ? (partes[1] ?? null) : null;
}

export function auditLog(req: Request, res: Response, next: NextFunction) {
  if (!METODOS_AUDITADOS.has(req.method)) return next();

  // El body hay que capturarlo ahora: algun handler podria mutarlo.
  const payload = redactar(req.body);

  // Interceptamos res.json solo para quedarnos con el id de lo creado.
  let idDeRespuesta: string | null = null;
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo: unknown) => {
    const data = (cuerpo as { data?: { id?: unknown } } | null)?.data;
    if (data && typeof data.id === 'string') idDeRespuesta = data.id;
    return jsonOriginal(cuerpo);
  };

  res.on('finish', () => {
    // Solo se auditan las que realmente cambiaron algo.
    if (res.statusCode < 200 || res.statusCode >= 300) return;

    const url = req.originalUrl ?? req.url;

    const serializado = JSON.stringify(payload ?? null);
    const payloadFinal =
      serializado && serializado.length > MAX_PAYLOAD_CHARS
        ? { truncado: true, bytes: serializado.length }
        : payload;

    // Escritura en segundo plano: auditar no debe retrasar ni romper la
    // respuesta, que a estas alturas ya se envio.
    prisma.auditLog
      .create({
        data: {
          actorId: req.user?.id ?? null,
          actorEmail: correoDe(req),
          actorRole: req.user?.role ?? null,
          // Para un ADMIN con empresa activa, aqui queda registrado en
          // nombre de que empresa actuo.
          companyId: req.user?.companyId ?? null,
          action: accionDe(req.method),
          resourceType: recursoDe(url),
          resourceId: idDe(url, idDeRespuesta),
          method: req.method,
          path: url,
          status: res.statusCode,
          payload: (payloadFinal ?? undefined) as never,
        },
      })
      .catch((err) => {
        // Si la auditoria falla lo dejamos en el log del servidor, pero la
        // peticion del usuario ya se completo correctamente.
        logger.error({ err, path: url }, 'No se pudo escribir el registro de auditoria');
      });
  });

  next();
}
