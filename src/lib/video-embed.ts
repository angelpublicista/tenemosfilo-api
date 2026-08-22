// Videos de portada alojados en YouTube o Vimeo.
//
// Se guarda la URL tal como la pega el anfitrion, no la de incrustacion:
// si mañana cambian los parametros del reproductor, se ajusta al pintar y
// no hay que migrar lo guardado.

export type ProveedorVideo = 'YOUTUBE' | 'VIMEO';

export type VideoPortada = {
  proveedor: ProveedorVideo;
  id: string;
  /** Vimeo lo usa para videos no listados; YouTube no tiene equivalente. */
  hash?: string;
};

/**
 * Reconoce las formas en que la gente comparte un video.
 *
 * Devuelve null si la URL no es de ninguno de los dos, que es lo que hace
 * que el formulario pueda rechazarla con un mensaje util en vez de guardar
 * algo que luego no se ve.
 */
export function parsearVideo(url: string): VideoPortada | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }

  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const partes = u.pathname.split('/').filter(Boolean);

  // youtu.be/ID
  if (host === 'youtu.be') {
    return partes[0] ? { proveedor: 'YOUTUBE', id: partes[0] } : null;
  }

  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    // youtube.com/watch?v=ID
    const v = u.searchParams.get('v');
    if (v) return { proveedor: 'YOUTUBE', id: v };
    // youtube.com/embed/ID, /shorts/ID, /live/ID
    if (['embed', 'shorts', 'live', 'v'].includes(partes[0] ?? '') && partes[1]) {
      return { proveedor: 'YOUTUBE', id: partes[1] };
    }
    return null;
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // player.vimeo.com/video/ID  ·  vimeo.com/ID  ·  vimeo.com/ID/HASH
    const idx = partes[0] === 'video' ? 1 : 0;
    const id = partes[idx];
    if (!id || !/^\d+$/.test(id)) return null;
    // El hash puede venir en la ruta o como ?h=
    const hash = partes[idx + 1] ?? u.searchParams.get('h') ?? undefined;
    return { proveedor: 'VIMEO', id, ...(hash ? { hash } : {}) };
  }

  return null;
}

export function esVideoSoportado(url: string): boolean {
  return parsearVideo(url) !== null;
}
