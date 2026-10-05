// Las estrellas del comensal (TR-24).
//
// Cuatro dimensiones y no una: experiencia general, servicio, ubicacion y
// comida. Son cuatro decisiones distintas del anfitrion —un sitio incomodo con
// comida excelente no se arregla igual que lo contrario— y una nota unica no
// dice cual de las dos pasa.
//
// Sin comentarios ni fotos a proposito: esta en el §7 del documento, y moderar
// texto de desconocidos es un producto en si mismo.
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export interface Calificacion {
  general: number;
  servicio: number;
  ubicacion: number;
  comida: number;
  fecha: string;
}

/** El token del enlace para calificar. Opaco y de un solo uso. */
export function nuevoTokenDeCalificacion(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Recalcula la nota de la experiencia con las calificaciones de sus reservas.
 *
 * Se calcula sobre la marcha y se guarda en la experiencia porque el catalogo
 * ordena por ella: calcularlo en cada listado seria una agregacion por cada
 * tarjeta. Lo que se guarda es el promedio de las "generales", que es la que
 * resume; las otras tres se miran por separado cuando se quiere saber que
 * arreglar.
 */
export async function recalcularNotaDeExperiencia(experienceId: string): Promise<void> {
  const calificadas = await prisma.reservation.findMany({
    where: { experienceId, NOT: { ratings: { equals: Prisma.DbNull } } },
    select: { ratings: true },
  });

  const generales = calificadas
    .map((r) => Number((r.ratings as { general?: unknown } | null)?.general ?? 0))
    .filter((n) => n >= 1 && n <= 5);

  if (generales.length === 0) return;

  const promedio = generales.reduce((a, b) => a + b, 0) / generales.length;
  await prisma.experience.update({
    where: { id: experienceId },
    // Un decimal: "4.3" dice algo, "4.2857142857" no dice nada mas.
    data: { rating: Math.round(promedio * 10) / 10 },
  });
}

/** El promedio de cada dimension, para que el anfitrion sepa que arreglar. */
export async function notasDeExperiencia(experienceId: string) {
  const calificadas = await prisma.reservation.findMany({
    where: { experienceId, NOT: { ratings: { equals: Prisma.DbNull } } },
    select: { ratings: true },
  });

  const dimensiones = ['general', 'servicio', 'ubicacion', 'comida'] as const;
  const suma: Record<string, { total: number; cuantas: number }> = {};
  for (const d of dimensiones) suma[d] = { total: 0, cuantas: 0 };

  for (const r of calificadas) {
    const c = r.ratings as Record<string, unknown> | null;
    for (const d of dimensiones) {
      const n = Number(c?.[d] ?? 0);
      if (n >= 1 && n <= 5) {
        suma[d]!.total += n;
        suma[d]!.cuantas += 1;
      }
    }
  }

  const promedio = (d: string) =>
    suma[d]!.cuantas > 0 ? Math.round((suma[d]!.total / suma[d]!.cuantas) * 10) / 10 : null;

  return {
    cuantas: calificadas.length,
    general: promedio('general'),
    servicio: promedio('servicio'),
    ubicacion: promedio('ubicacion'),
    comida: promedio('comida'),
  };
}
