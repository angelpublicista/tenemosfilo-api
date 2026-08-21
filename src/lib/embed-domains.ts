// Origenes autorizados a insertar el catalogo en un iframe.
//
// Se guardan ya normalizados como origen ("https://misitio.com") porque es
// el formato que entiende `frame-ancestors`. La gente pega la URL de mil
// formas —con barra final, con www, con la ruta entera— y todas deben
// acabar igual, o el navegador bloqueara un dominio que el usuario cree
// haber autorizado.

/**
 * Convierte lo que escriba el usuario en un origen valido, o null si no
 * hay forma de interpretarlo.
 *
 *   "misitio.com"                -> "https://misitio.com"
 *   "https://misitio.com/precios"-> "https://misitio.com"
 *   "http://localhost:3000"      -> "http://localhost:3000"
 */
export function normalizarDominio(entrada: string): string | null {
  const texto = entrada.trim();
  if (!texto) return null;

  // Sin esquema asumimos https, que es lo normal hoy. Excepcion: localhost
  // y las IPs locales, donde lo habitual sigue siendo http.
  const conEsquema = /^https?:\/\//i.test(texto)
    ? texto
    : `${/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(texto) ? 'http' : 'https'}://${texto}`;

  try {
    const url = new URL(conEsquema);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    // origin ya descarta ruta, query y barra final.
    return url.origin;
  } catch {
    return null;
  }
}

/** Normaliza una lista quitando vacios y repetidos, conservando el orden. */
export function normalizarDominios(entradas: string[]): string[] {
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const e of entradas) {
    const origen = normalizarDominio(e);
    if (origen && !vistos.has(origen)) {
      vistos.add(origen);
      salida.push(origen);
    }
  }
  return salida;
}

/**
 * Valor de `frame-ancestors` para una empresa.
 *
 * Lista vacia = 'self' mas cualquiera. Se devuelve null para que quien
 * llame decida no emitir la cabecera: emitir `frame-ancestors *` seria
 * equivalente pero deja peor sabor en una auditoria de seguridad.
 */
export function frameAncestors(dominios: string[]): string | null {
  const limpios = normalizarDominios(dominios);
  if (limpios.length === 0) return null;
  // 'self' siempre: la propia app necesita poder previsualizar el catalogo.
  return ["'self'", ...limpios].join(' ');
}
