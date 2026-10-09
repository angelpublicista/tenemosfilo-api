// Piezas del servidor de autorizacion (OAuth 2.1) que usa el servidor MCP.
//
// Todo lo que aqui se emite es opaco y se guarda hasheado, igual que las API
// keys. Los prefijos no son seguridad: sirven para reconocer de un vistazo
// que es cada cosa en un log o en una configuracion mal pegada.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env.js';

export const PREFIJO_ACCESO = 'tfo_at_';
export const PREFIJO_REFRESCO = 'tfo_rt_';
const PREFIJO_CODIGO = 'tfo_ac_';

/** Un codigo se canjea al momento: diez minutos sobran. */
export const VIDA_DEL_CODIGO_MS = 10 * 60 * 1000;
/** Corto a proposito: si se filtra, deja de valer solo. */
export const VIDA_DEL_ACCESO_MS = 60 * 60 * 1000;
/** Rota en cada uso; esto es cuanto aguanta una conexion sin usarse. */
export const VIDA_DEL_REFRESCO_MS = 90 * 24 * 60 * 60 * 1000;

export const hashDeToken = (token: string) => createHash('sha256').update(token).digest('hex');

const nuevo = (prefijo: string) => `${prefijo}${randomBytes(32).toString('base64url')}`;
export const nuevoCodigo = () => nuevo(PREFIJO_CODIGO);
export const nuevoTokenDeAcceso = () => nuevo(PREFIJO_ACCESO);
export const nuevoTokenDeRefresco = () => nuevo(PREFIJO_REFRESCO);

/**
 * La URL publica de este API, sin barra final.
 *
 * Es el `issuer` y la base de todos los endpoints que se anuncian, asi que
 * tiene que ser la que ve el asistente desde fuera. Si no esta configurada
 * se deduce de la peticion, que en local basta; en produccion, detras de un
 * proxy, conviene fijarla con API_PUBLIC_URL.
 */
export function urlDelApi(req: Request): string {
  const base = env.API_PUBLIC_URL ?? `${req.protocol}://${req.get('host')}`;
  return base.replace(/\/+$/, '');
}

/** El recurso que protegen los tokens: el endpoint MCP. */
export const urlDelMcp = (req: Request) => `${urlDelApi(req)}/mcp`;

/** PKCE S256: base64url(sha256(verifier)) tiene que ser el challenge. */
export function pkceValido(verifier: string, challenge: string): boolean {
  const calculado = createHash('sha256').update(verifier).digest('base64url');
  return calculado === challenge;
}

const esLoopback = (host: string) =>
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]';

/**
 * Si una URI de redireccion se puede registrar.
 *
 * Tres familias, que son las que usan los asistentes de verdad:
 *   - https: los conectores web (claude.ai, ChatGPT).
 *   - http solo hacia la propia maquina: las apps de escritorio y de
 *     terminal levantan un servidor local para recibir el codigo.
 *   - un esquema propio (cursor://, vscode://): apps nativas.
 *
 * Lo que no entra es http hacia fuera —el codigo viajaria en claro— ni los
 * esquemas que un navegador ejecuta en vez de abrir.
 */
export function uriDeRedireccionAdmisible(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return esLoopback(u.hostname);
  return !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'].includes(u.protocol);
}

/**
 * Si la URI que llega es una de las que el cliente registro.
 *
 * Comparacion exacta, con una sola excepcion que marca el estandar (RFC
 * 8252): hacia la propia maquina el puerto no cuenta, porque la app elige
 * uno libre cada vez que arranca.
 */
export function uriRegistrada(registradas: string[], uri: string): boolean {
  if (registradas.includes(uri)) return true;
  let pedida: URL;
  try {
    pedida = new URL(uri);
  } catch {
    return false;
  }
  if (pedida.protocol !== 'http:' || !esLoopback(pedida.hostname)) return false;
  return registradas.some((r) => {
    try {
      const reg = new URL(r);
      return (
        reg.protocol === 'http:' &&
        esLoopback(reg.hostname) &&
        reg.pathname === pedida.pathname &&
        reg.search === pedida.search
      );
    } catch {
      return false;
    }
  });
}

/** Añade parametros a la URI de redireccion respetando los que ya traiga. */
export function conParametros(uri: string, parametros: Record<string, string | undefined>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(parametros)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return u.toString();
}
