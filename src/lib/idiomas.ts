// Los idiomas en que puede darse una experiencia.
//
// Una lista cerrada y no texto libre: "Ingles", "ingles" e "ING" son el mismo
// idioma escrito de tres formas, y con texto libre el catalogo no se puede
// filtrar ni la reserva comprobar contra nada.
//
// Codigos ISO 639-1 porque es el estandar que ya entienden los navegadores y
// cualquier integracion futura. La lista empieza corta a proposito: ampliarla
// es una linea, y cada idioma de mas es una casilla mas que nadie usa.

import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';

export const IDIOMAS = {
  es: 'Español',
  en: 'Inglés',
  pt: 'Portugués',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
} as const;

export type Idioma = keyof typeof IDIOMAS;

export const CODIGOS = Object.keys(IDIOMAS) as [Idioma, ...Idioma[]];

/** El nombre del idioma, o el codigo tal cual si no lo conocemos. */
export function nombreDeIdioma(codigo: string): string {
  return IDIOMAS[codigo as Idioma] ?? codigo;
}

/** "Español e inglés", para enseñarlo de corrido. */
export function listaDeIdiomas(codigos: string[]): string {
  const nombres = codigos.map(nombreDeIdioma);
  if (nombres.length === 0) return '';
  if (nombres.length === 1) return nombres[0]!;
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/**
 * Que el idioma pedido sea uno de los que la experiencia ofrece.
 *
 * Se comprueba al vender y no solo en el formulario porque el checkout no
 * mira el catalogo: con el enlace en la mano se puede mandar cualquier
 * idioma, y el anfitrion acabaria con una reserva en frances que no puede
 * atender.
 *
 * Una experiencia sin idiomas declarados acepta la reserva sin idioma —es el
 * caso de todas las que ya existen— pero no acepta que se pida uno concreto:
 * nadie ha dicho que se de en ese idioma.
 */
export async function comprobarIdioma(
  experienceId: string,
  idioma?: string | null,
): Promise<void> {
  if (!idioma) return;
  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { languages: true },
  });
  const ofrece = exp?.languages ?? [];
  if (ofrece.includes(idioma)) return;
  throw BadRequest(
    ofrece.length === 0
      ? 'Esta experiencia no tiene idiomas declarados.'
      : `Esta experiencia no se da en ${nombreDeIdioma(idioma)}.`,
    { motivo: 'IDIOMA_NO_DISPONIBLE', idiomas: ofrece },
  );
}
