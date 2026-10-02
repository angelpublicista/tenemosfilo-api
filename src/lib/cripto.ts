// Cifrado de las credenciales de cobro de los anfitriones.
//
// Estas llaves no son nuestras: con ellas se cobra dinero en nombre de otra
// empresa. Guardarlas en claro significa que una copia de la base —un volcado
// para depurar, una replica mal configurada, una copia de seguridad que se
// filtra— basta para cobrar suplantando a cualquier anfitrion.
//
// AES-256-GCM: cifra y autentica a la vez, asi que un texto manipulado falla
// al descifrar en vez de devolver basura que parezca una llave.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from './logger.js';

const PREFIJO = 'v1';
const ALGORITMO = 'aes-256-gcm';

/**
 * La llave maestra, de 32 bytes en hexadecimal.
 *
 * Se lee en cada uso y no al arrancar a proposito: el API tiene que poder
 * levantar sin ella. Solo hace falta para las pasarelas propias, y un
 * despliegue al que aun no se le ha puesto la variable debe seguir sirviendo
 * el catalogo y las reservas en vez de no arrancar.
 */
function llaveMaestra(): Buffer | null {
  const hex = env.CREDENTIALS_KEY;
  if (!hex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    logger.error('CREDENTIALS_KEY no son 64 caracteres hexadecimales: se ignora');
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/** Si se pueden guardar credenciales de pasarela en este despliegue. */
export function hayLlaveDeCifrado(): boolean {
  return llaveMaestra() !== null;
}

/**
 * Cifra un secreto. Devuelve `v1:iv:tag:texto`, todo en base64url.
 *
 * Lanza si no hay llave: es preferible que guardar una credencial falle a que
 * se guarde en claro sin que nadie se entere.
 */
export function cifrar(texto: string): string {
  const llave = llaveMaestra();
  if (!llave) {
    throw new Error('No hay CREDENTIALS_KEY configurada: no se pueden guardar credenciales');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO, llave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIJO, iv.toString('base64url'), tag.toString('base64url'), cifrado.toString('base64url')].join(':');
}

/**
 * Descifra. Devuelve null si no se puede, y no lanza.
 *
 * Quien llama esta casi siempre construyendo un cobro, y ahi un null significa
 * "esta pasarela no se puede usar" —que es algo que ya sabe manejar— mientras
 * que una excepcion tumbaria una reserva entera.
 */
export function descifrar(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  const llave = llaveMaestra();
  if (!llave) return null;

  const [version, iv, tag, cifrado] = guardado.split(':');
  if (!iv || !tag || !cifrado || version !== PREFIJO) {
    logger.error('Credencial con formato desconocido: no se puede descifrar');
    return null;
  }
  try {
    const decipher = createDecipheriv(ALGORITMO, llave, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(cifrado, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Llave cambiada o dato manipulado. Sin detalles en el log: lo unico que
    // se puede decir es que no descifra.
    logger.error('No se pudo descifrar una credencial de pasarela');
    return null;
  }
}

/**
 * Descifra lo que este cifrado y devuelve tal cual lo que no.
 *
 * Existe por las llaves de Wompi de la propia plataforma: se guardaron en
 * claro antes de que hubiera cifrado, y el dia que se despliega el cifrado
 * siguen en claro en produccion. Sin esta tolerancia, ese despliegue dejaria
 * los cobros rotos hasta que alguien volviera a teclear las llaves.
 *
 * Se puede quitar en cuanto `scripts/cifrar-llaves-de-la-plataforma.ts` haya
 * corrido en todos los despliegues y no quede nada en claro.
 */
export function descifrarHeredado(guardado: string | null | undefined): string | null {
  if (!guardado) return null;
  return guardado.startsWith(`${PREFIJO}:`) ? descifrar(guardado) : guardado;
}

/** Si un valor guardado ya pasó por `cifrar`. */
export function estaCifrado(guardado: string | null | undefined): boolean {
  return Boolean(guardado?.startsWith(`${PREFIJO}:`));
}
