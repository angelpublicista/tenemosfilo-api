// Las condiciones con que una experiencia se vende en una sede.
//
// Una experiencia es una pieza con la que se arma el catalogo: el mismo taller
// puede estar en el local del centro como abierta —cupos sueltos— y en la
// finca como privada, con otro aforo, otro precio y otra anticipacion. Esas
// diferencias viven en `LocationListing`, y este modulo es el UNICO sitio que
// decide cual gana.
//
// Esta aqui y no repartido por los servicios porque cuando la misma pregunta
// se responde en varios sitios, acaban respondiendola distinto: ya paso con la
// cascada de horarios, donde el corte de anticipacion y el conteo de cupos
// miraban calendarios diferentes sin que nadie se diera cuenta.
import { prisma } from '../config/prisma.js';
import type { ExperienceKind, Prisma } from '@prisma/client';

type Cliente = Prisma.TransactionClient | typeof prisma;

export interface Condiciones {
  /** La sede cuyas condiciones se aplicaron, si se pudo determinar una. */
  locationId: string | null;
  /** Cupos sueltos o sitio completo. null = contar cupos, como siempre. */
  kind: ExperienceKind | null;
  capacity: number | null;
  minCapacity: number | null;
  basePrice: Prisma.Decimal | null;
  /** Minutos. */
  prepTime: number | null;
  /** Minutos. */
  cleanupTime: number | null;
  /** Horas. */
  minimumNotice: number | null;
  /** Si la experiencia se esta ofreciendo en esa sede ahora mismo. */
  isPublished: boolean;
}

/**
 * La sede que se da por supuesta cuando nadie la nombra.
 *
 * Con una sola sede no hay ambiguedad y pedir que la digan en cada llamada
 * solo serviria para que algunas se olvidaran y leyeran las condiciones
 * equivocadas. Con varias no se adivina: devuelve null y manda la experiencia.
 */
async function sedeUnica(experienceId: string, cliente: Cliente): Promise<string | null> {
  const sedes = await cliente.location.findMany({
    where: { deletedAt: null, experiences: { some: { id: experienceId } } },
    select: { id: true },
    take: 2,
  });
  return sedes.length === 1 ? sedes[0]!.id : null;
}

/**
 * Las condiciones que rigen para una experiencia, en la sede indicada.
 *
 * Campo a campo: lo que diga la sede si lo dice, y si no lo que diga la
 * experiencia. No se mezcla al reves ni se exige que la sede declare todo —el
 * caso normal es que solo cambie una cosa, el aforo o el precio, y repetir las
 * otras seis seria una invitacion a que se queden viejas—.
 */
export async function condicionesDe(
  experienceId: string,
  locationId?: string | null,
  cliente: Cliente = prisma,
): Promise<Condiciones> {
  const exp = await cliente.experience.findUnique({
    where: { id: experienceId },
    select: {
      capacity: true,
      minCapacity: true,
      basePrice: true,
      prepTime: true,
      cleanupTime: true,
      minimumNotice: true,
    },
  });

  const sede = locationId ?? (await sedeUnica(experienceId, cliente));

  const ficha = sede
    ? await cliente.locationListing.findFirst({
        where: { experienceId, locationId: sede, deletedAt: null },
      })
    : null;

  return {
    locationId: sede,
    kind: ficha?.kind ?? null,
    capacity: ficha?.capacity ?? exp?.capacity ?? null,
    minCapacity: ficha?.minCapacity ?? exp?.minCapacity ?? null,
    basePrice: ficha?.basePrice ?? exp?.basePrice ?? null,
    prepTime: ficha?.prepTime ?? exp?.prepTime ?? null,
    cleanupTime: ficha?.cleanupTime ?? exp?.cleanupTime ?? null,
    minimumNotice: ficha?.minimumNotice ?? exp?.minimumNotice ?? null,
    isPublished: ficha?.isPublished ?? true,
  };
}

/**
 * Las sedes donde la experiencia esta ofreciendose, con sus condiciones.
 *
 * Una sede sin ficha sale igual, con las condiciones de la experiencia: estar
 * en el catalogo no depende de haber declarado nada aparte.
 */
export async function sedesDe(experienceId: string, cliente: Cliente = prisma) {
  const sedes = await cliente.location.findMany({
    where: { deletedAt: null, experiences: { some: { id: experienceId } } },
    select: { id: true, name: true, isMain: true, address: true },
    orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
  });

  return Promise.all(
    sedes.map(async (s) => ({
      ...s,
      condiciones: await condicionesDe(experienceId, s.id, cliente),
    })),
  );
}
