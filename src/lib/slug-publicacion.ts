// La URL propia de una publicacion del catalogo.
//
// <experiencia>-<sede> o <experiencia>-a-domicilio. Se calcula una vez, al
// crear la publicacion, y no se recalcula: renombrar la experiencia o la sede
// no puede romper un enlace que ya se compartio.
import { prisma } from '../config/prisma.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/** Cuanto puede medir, para que la URL siga siendo una URL. */
const MAX = 110;

/** El slug libre para una publicacion nueva. */
export async function slugParaPublicacion(
  experienceSlug: string,
  nombreDeSede: string | null,
): Promise<string> {
  const sufijo = nombreDeSede === null ? 'a-domicilio' : slugify(nombreDeSede) || 'sede';
  const base = `${experienceSlug}-${sufijo}`.slice(0, MAX).replace(/-$/, '');

  let candidato = base;
  for (let i = 2; ; i += 1) {
    const ocupado = await prisma.locationListing.findUnique({
      where: { slug: candidato },
      select: { id: true },
    });
    if (!ocupado) return candidato;
    candidato = `${base}-${i}`;
  }
}
