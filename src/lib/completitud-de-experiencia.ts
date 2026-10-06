// Si una experiencia esta lista para venderse (TR-23).
//
// Guardar a medias tiene que poder hacerse: nadie rellena una ficha de una
// sentada, y obligar a terminarla para guardar lo que ya se escribio hace que
// se pierda. Lo que no puede es venderse a medias — un cliente que compra una
// experiencia sin precio, sin duracion o sin sitio compra una incognita.
//
// La completitud se CALCULA, no se guarda: si fuera un campo, se quedaria
// desactualizado el dia que alguien borre la descripcion desde otra pantalla.
// Y va aparte del estado a proposito: "borrador" es una decision del anfitrion
// e "incompleta" es un hecho de la ficha.
import type { Prisma } from '@prisma/client';

/** Lo que hace falta mirar para saber si se puede vender. */
export const PARA_COMPLETITUD = {
  id: true,
  title: true,
  description: true,
  categories: true,
  duration: true,
  capacity: true,
  basePrice: true,
  atHome: true,
  presentialCity: true,
  presentialLocation: true,
  featuredImage: true,
  locations: { select: { id: true } },
} satisfies Prisma.ExperienceSelect;

export interface Completitud {
  completa: boolean;
  /** Lo que falta, en palabras que la pantalla puede enseñar tal cual. */
  falta: string[];
  /** Lo que conviene pero no impide vender. */
  recomendado: string[];
}

type Ficha = {
  title?: string | null;
  description?: string | null;
  categories?: string[] | null;
  duration?: number | null;
  capacity?: number | null;
  basePrice?: Prisma.Decimal | number | null;
  atHome?: boolean | null;
  presentialCity?: string | null;
  presentialLocation?: string | null;
  featuredImage?: string | null;
  locations?: { id: string }[] | null;
};

export function completitudDeExperiencia(e: Ficha): Completitud {
  const falta: string[] = [];
  const recomendado: string[] = [];

  if (!e.title?.trim()) falta.push('el nombre');
  if (!e.description?.trim()) falta.push('la descripción');
  if (!e.categories || e.categories.length === 0) falta.push('al menos una categoría');
  if (!e.duration || e.duration <= 0) falta.push('la duración');
  // Sin cupos no hay inventario que vender: no se sabe cuanta gente cabe.
  if (!e.capacity || e.capacity <= 0) falta.push('los cupos por sesión');
  if (e.basePrice === null || e.basePrice === undefined || Number(e.basePrice) <= 0) {
    falta.push('el precio');
  }

  // Donde ocurre.
  //
  // A domicilio no hace falta sede —la direccion la pone quien reserva— pero
  // si hace falta saber DONDE se presta: un chef que va a casa del cliente no
  // cruza el pais, y sin la ciudad el catalogo se le ofrece a gente a la que
  // no puede atender.
  if (e.atHome) {
    if (!e.presentialCity?.trim()) falta.push('la ciudad donde lo prestas');
  } else if ((e.locations?.length ?? 0) === 0 && !e.presentialLocation?.trim()) {
    falta.push('el lugar o la sede');
  }

  // La foto no impide transaccionar, pero una tarjeta sin imagen no se vende.
  // Se dice aparte para no bloquear por algo que no rompe nada.
  if (!e.featuredImage?.trim()) recomendado.push('una imagen de portada');

  return { completa: falta.length === 0, falta, recomendado };
}

/** El texto de por que no se puede publicar, ya escrito. */
export function porQueNoSePuedeVender(c: Completitud): string {
  const lista =
    c.falta.length === 1
      ? c.falta[0]
      : `${c.falta.slice(0, -1).join(', ')} y ${c.falta[c.falta.length - 1]}`;
  return `Esta experiencia no está lista para venderse: falta ${lista}.`;
}
