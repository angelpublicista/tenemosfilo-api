// La agenda del anfitrion: que mas tiene encima a esa misma hora.
//
// TR-42. El aforo dice si cabe gente en una experiencia; esto dice si cabe la
// experiencia en el dia del anfitrion. Son cosas distintas y hasta ahora solo
// se miraba la primera: se podia vender una cena a las ocho en la sede del
// norte teniendo otra a las ocho en la del sur, y las dos con el mismo equipo.
//
// La regla tiene dos niveles a proposito:
//
//   - Misma sede fisica: no se puede. El sitio es uno y no se parte en dos.
//   - Sedes distintas: se avisa y se puede seguir. Un anfitrion con dos
//     equipos lo hace todos los dias, y un bloqueo duro le impediria trabajar.
//
// Dos reservas de la MISMA experiencia a la misma hora no son un solape: son
// dos grupos de la misma sesion, y de eso ya se encarga el aforo.
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';
import { condicionesDe } from './sede-de-la-experiencia.js';

type Cliente = PrismaClient | Prisma.TransactionClient;

/** Cuanto dura algo cuando nadie lo dice. */
const DURACION_POR_DEFECTO_MIN = 60;

/**
 * TR-19. Lo que ocupa de verdad una experiencia: montar, hacerla y recoger.
 *
 * Una cena de tres horas no deja el sitio libre a las tres. Si la agenda solo
 * mirara la duracion, dos cenas seguidas cabrian sobre el papel y en la
 * practica la segunda empezaria con el equipo recogiendo la primera.
 */
export function ocupacionEnMinutos(e: {
  duration?: number | null;
  prepTime?: number | null;
  cleanupTime?: number | null;
}): number {
  return (e.prepTime ?? 0) + (e.duration ?? DURACION_POR_DEFECTO_MIN) + (e.cleanupTime ?? 0);
}

export interface Solape {
  reservationNumber: string;
  experiencia: string;
  fecha: string;
  sede: string | null;
  mismaSede: boolean;
}

export interface Simultaneidad {
  mismaSede: Solape[];
  otraSede: Solape[];
}

/**
 * Lo que el anfitrion ya tiene encima en esa franja.
 *
 * Se comparan franjas, no instantes: una cena de tres horas que empieza a las
 * siete choca con otra que empieza a las nueve aunque las horas de inicio no
 * coincidan.
 */
export async function simultaneidad(
  cliente: Cliente,
  datos: {
    companyId: string;
    experienceId: string;
    locationId?: string | null;
    fecha: Date;
    duracionMin?: number | null;
  },
): Promise<Simultaneidad> {
  // TR-19. La franja que ocupa esto es montaje + duracion + limpieza. La
  // duracion que llega en la reserva manda sobre la de la ficha —puede ser
  // una cena mas larga de lo habitual— pero los montajes son de la
  // experiencia y no se mandan por reserva.
  //
  // Los montajes son de la SEDE cuando ella los declara: la finca pide dos
  // horas de montaje que el local del centro no necesita, y con el dato de la
  // experiencia la agenda dejaba meter otra cosa en ese rato.
  const ficha = await cliente.experience.findUnique({
    where: { id: datos.experienceId },
    select: { duration: true },
  });
  const condiciones = await condicionesDe(datos.experienceId, datos.locationId, cliente);
  const duracion = ocupacionEnMinutos({
    duration: datos.duracionMin ?? ficha?.duration ?? DURACION_POR_DEFECTO_MIN,
    prepTime: condiciones.prepTime,
    cleanupTime: condiciones.cleanupTime,
  });
  // El montaje empieza antes de la hora de la reserva: ahi ya esta ocupado.
  const inicio = new Date(datos.fecha.getTime() - (condiciones.prepTime ?? 0) * 60_000);
  const fin = new Date(inicio.getTime() + duracion * 60_000);

  // Se trae la franja ancha del dia y el solape se calcula aqui: cruzar
  // fecha + duracion en SQL obligaria a un raw query por una comodidad.
  const inicioDelDia = new Date(datos.fecha);
  inicioDelDia.setHours(0, 0, 0, 0);
  const finDelDia = new Date(inicioDelDia);
  finDelDia.setDate(finDelDia.getDate() + 2);

  const candidatas = await cliente.reservation.findMany({
    where: {
      companyId: datos.companyId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      reservationDate: { gte: inicioDelDia, lt: finDelDia },
      experienceId: { not: datos.experienceId },
    },
    select: {
      reservationNumber: true,
      reservationDate: true,
      duration: true,
      experienceId: true,
      locationId: true,
      experience: {
        select: { title: true, duration: true, prepTime: true, cleanupTime: true },
      },
      location: { select: { name: true } },
    },
  });

  // Los montajes propios de cada sede, de una vez y no uno por candidata:
  // esto corre dentro del cerrojo de una venta y una consulta por reserva
  // haria esperar al resto de la cola.
  const pares = candidatas
    .filter((c) => !!c.locationId)
    .map((c) => ({ experienceId: c.experienceId, locationId: c.locationId! }));
  const fichas = pares.length
    ? await cliente.locationListing.findMany({
        where: { deletedAt: null, OR: pares },
        select: { experienceId: true, locationId: true, prepTime: true, cleanupTime: true },
      })
    : [];
  const propio = new Map(fichas.map((f) => [`${f.experienceId}:${f.locationId}`, f]));

  const salida: Simultaneidad = { mismaSede: [], otraSede: [] };

  for (const c of candidatas) {
    const f = c.locationId ? propio.get(`${c.experienceId}:${c.locationId}`) : undefined;
    const montaje = f?.prepTime ?? c.experience?.prepTime ?? 0;
    const dur = ocupacionEnMinutos({
      duration: c.duration ?? c.experience?.duration ?? DURACION_POR_DEFECTO_MIN,
      prepTime: montaje,
      cleanupTime: f?.cleanupTime ?? c.experience?.cleanupTime,
    });
    const cInicio = new Date(c.reservationDate.getTime() - montaje * 60_000);
    const cFin = new Date(cInicio.getTime() + dur * 60_000);
    // Se tocan si una empieza antes de que la otra acabe, por los dos lados.
    if (cInicio >= fin || cFin <= inicio) continue;

    // Misma sede solo cuando las dos la tienen y es la misma. Sin sede no se
    // puede afirmar que sea el mismo sitio, y afirmarlo bloquearia ventas
    // buenas por un dato que nadie lleno.
    const mismaSede =
      !!datos.locationId && !!c.locationId && datos.locationId === c.locationId;

    const solape: Solape = {
      reservationNumber: c.reservationNumber,
      experiencia: c.experience?.title ?? 'otra experiencia',
      fecha: cInicio.toISOString(),
      sede: c.location?.name ?? null,
      mismaSede,
    };
    (mismaSede ? salida.mismaSede : salida.otraSede).push(solape);
  }

  return salida;
}

const hora = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * TR-37. Una sede inactiva no admite reservas nuevas.
 *
 * Desactivarla es decir "aqui ya no". Las que ya estaban vendidas alli siguen
 * en pie: cancelarlas en bloque por un ajuste de ficha seria pasarse, y eso lo
 * decide el anfitrion reserva por reserva.
 */
export async function comprobarSedeActiva(
  locationId: string | null | undefined,
  cliente: Cliente = prisma,
): Promise<void> {
  if (!locationId) return;
  const sede = await cliente.location.findFirst({
    where: { id: locationId, deletedAt: null },
    select: { isActive: true, name: true },
  });
  if (sede && !sede.isActive) {
    throw BadRequest(`${sede.name} está inactiva y no admite reservas nuevas.`, {
      motivo: 'SEDE_INACTIVA',
    });
  }
}

/**
 * Rechaza lo que no puede convivir y deja pasar lo que si, con aviso.
 *
 * `permitirSolape` es el "programar de todas formas" del requisito: solo
 * levanta el aviso de sedes distintas, nunca el bloqueo de la misma sede.
 * Que se pueda saltar lo imposible no es una opcion que ofrecer.
 */
export async function comprobarSimultaneidad(
  datos: {
    companyId: string;
    experienceId: string;
    locationId?: string | null;
    fecha: Date;
    duracionMin?: number | null;
  },
  opts: { permitirSolape?: boolean } = {},
  cliente: Cliente = prisma,
): Promise<Simultaneidad> {
  const s = await simultaneidad(cliente, datos);

  // El `motivo` en los detalles es para la pantalla: uno se puede ofrecer
  // "programar de todas formas" y el otro no, y distinguirlos por el texto del
  // mensaje seria atarse a como esta escrito hoy.
  const choque = s.mismaSede[0];
  if (choque) {
    throw BadRequest(
      `Esa sede ya está ocupada: ${choque.experiencia} el ${hora(choque.fecha)} ` +
        `(reserva ${choque.reservationNumber}). Elige otra hora u otra sede.`,
      { motivo: 'SEDE_OCUPADA', solapes: s.mismaSede },
    );
  }

  const aviso = s.otraSede[0];
  if (aviso && !opts.permitirSolape) {
    throw BadRequest(
      `A esa hora ya tienes ${aviso.experiencia}${aviso.sede ? ` en ${aviso.sede}` : ''} ` +
        `el ${hora(aviso.fecha)} (reserva ${aviso.reservationNumber}). ` +
        'Si tienes equipo para las dos, confirma para programarla de todas formas.',
      { motivo: 'SOLAPE_EN_OTRA_SEDE', solapes: s.otraSede },
    );
  }

  return s;
}
