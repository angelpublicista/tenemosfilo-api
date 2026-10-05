// Traer algo de una URL que escribio un usuario.
//
// Nuestro servidor esta dentro de la red privada y puede alcanzar sitios que
// quien escribe la URL no deberia poder tocar: la base de datos, el servicio
// de metadatos de la nube —169.254.169.254, que entrega credenciales— o
// cualquier cosa en localhost. Pedirle al servidor que descargue
// "http://169.254.169.254/latest/meta-data/" es un ataque conocido (SSRF) y
// una URL pegada en un formulario es exactamente por donde entra.
//
// De ahi que no se resuelva el nombre una vez y ya: se comprueba el destino en
// CADA salto, porque un dominio puede responder 302 hacia una IP interna
// despues de haber pasado la primera comprobacion.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequest } from './errors.js';

const MAX_REDIRECCIONES = 3;
const TIEMPO_LIMITE_MS = 10_000;

/** Rangos que nunca salen a internet. */
function esPrivada(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    // ::1 (loopback), fc00::/7 (unicas locales), fe80::/10 (enlace local).
    if (v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    if (v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb')) {
      return true;
    }
    // IPv4 mapeada: ::ffff:10.0.0.1 tiene que juzgarse como la IPv4 que lleva.
    const mapeada = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada?.[1]) return esPrivada(mapeada[1]);
    return false;
  }

  const partes = ip.split('.').map(Number);
  const a = partes[0] ?? -1;
  const b = partes[1] ?? -1;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16: enlace local, y ahi vive el servicio de metadatos.
  if (a === 169 && b === 254) return true;
  // 100.64.0.0/10, el rango de los operadores (CGNAT).
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Comprueba el destino de una URL concreta, ya resuelto a IP. */
async function destinoPermitido(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw BadRequest('Solo se pueden leer direcciones http o https.');
  }

  const host = u.hostname.replace(/^\[|\]$/g, '');
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true })).map((r) => r.address);

  if (ips.length === 0) throw BadRequest(`No se pudo resolver ${u.hostname}.`);
  if (ips.some(esPrivada)) {
    throw BadRequest('Esa dirección apunta a una red interna y no se puede leer.');
  }
}

export interface RespuestaExterna {
  url: string;
  contentType: string;
  cuerpo: Buffer;
}

/**
 * Descarga una URL externa con los limites puestos.
 *
 * Las redirecciones se siguen a mano, comprobando cada destino: `fetch` las
 * sigue solo y no deja mirar por donde paso.
 */
export async function traerDeInternet(
  urlInicial: string,
  opciones: { maxBytes: number; tiposAceptados?: RegExp },
): Promise<RespuestaExterna> {
  let actual: URL;
  try {
    actual = new URL(urlInicial);
  } catch {
    throw BadRequest('Esa no parece una dirección válida.');
  }

  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto += 1) {
    await destinoPermitido(actual);

    const corte = AbortSignal.timeout(TIEMPO_LIMITE_MS);
    const r = await fetch(actual, {
      redirect: 'manual',
      signal: corte,
      headers: {
        // Identificarse es lo correcto: quien no quiera que leamos su sitio
        // tiene que poder bloquearnos.
        'user-agent': 'TenemosFiloBot/1.0 (+https://tenemosfilo.com)',
        accept: '*/*',
      },
    }).catch(() => {
      throw BadRequest('No se pudo abrir esa dirección. Comprueba que carga en el navegador.');
    });

    if (r.status >= 300 && r.status < 400) {
      const siguiente = r.headers.get('location');
      if (!siguiente) throw BadRequest('Esa dirección redirige a ninguna parte.');
      actual = new URL(siguiente, actual);
      continue;
    }

    if (!r.ok) throw BadRequest(`Esa dirección respondió ${r.status}.`);

    const contentType = ((r.headers.get('content-type') ?? '').split(';')[0] ?? '')
      .trim()
      .toLowerCase();
    if (opciones.tiposAceptados && !opciones.tiposAceptados.test(contentType)) {
      throw BadRequest(`Eso no es lo que esperábamos (${contentType || 'sin tipo'}).`);
    }

    // El Content-Length se mira primero por cortesia, pero no se confia en el:
    // puede faltar o mentir, asi que el corte de verdad va sobre lo leido.
    const declarado = Number(r.headers.get('content-length') ?? 0);
    if (declarado > opciones.maxBytes) {
      throw BadRequest('Ese archivo es demasiado grande.');
    }

    const trozos: Buffer[] = [];
    let leidos = 0;
    const lector = r.body?.getReader();
    if (!lector) throw BadRequest('Esa dirección no devolvió contenido.');

    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      leidos += value.byteLength;
      if (leidos > opciones.maxBytes) {
        await lector.cancel();
        throw BadRequest('Ese archivo es demasiado grande.');
      }
      trozos.push(Buffer.from(value));
    }

    return { url: actual.toString(), contentType, cuerpo: Buffer.concat(trozos) };
  }

  throw BadRequest('Esa dirección redirige demasiadas veces.');
}
