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
import { BadRequest } from './errors.js';
import { fechaCerrada, franjasDeLaFecha, horariosQueAplican } from './franjas.js';
import type { ExperienceKind, Prisma } from '@prisma/client';

type Cliente = Prisma.TransactionClient | typeof prisma;

export interface Condiciones {
  /** La sede cuyas condiciones se aplicaron, si se pudo determinar una. */
  locationId: string | null;
  /** Cupos sueltos o sitio completo. null = contar cupos, como siempre. */
  kind: ExperienceKind | null;
  /**
   * El minimo para que la experiencia se haga. NO es inventario: los cupos
   * que se venden son de la franja, y este es el tamaño de grupo por debajo
   * del cual la cena no sale, que no cambia por ser sabado o martes.
   */
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
      minCapacity: true,
      basePrice: true,
      prepTime: true,
      cleanupTime: true,
      minimumNotice: true,
    },
  });

  const sede = locationId ?? (await sedeUnica(experienceId, cliente));

  // Sin sede tambien hay publicacion: es el caso de a domicilio, donde la
  // direccion la pone quien reserva. Su fila lleva `locationId` nulo.
  const ficha = await cliente.locationListing.findFirst({
    where: { experienceId, locationId: sede ?? null, deletedAt: null },
  });

  return {
    locationId: sede,
    kind: ficha?.kind ?? null,
    minCapacity: ficha?.minCapacity ?? exp?.minCapacity ?? null,
    basePrice: ficha?.basePrice ?? exp?.basePrice ?? null,
    prepTime: ficha?.prepTime ?? exp?.prepTime ?? null,
    cleanupTime: ficha?.cleanupTime ?? exp?.cleanupTime ?? null,
    minimumNotice: ficha?.minimumNotice ?? exp?.minimumNotice ?? null,
    isPublished: ficha?.isPublished ?? true,
  };
}

/**
 * Rechaza una compra de una publicacion en pausa.
 *
 * Pausar es dejar de vender ahi. Sin esta comprobacion, quien tuviera el
 * enlace podia seguir comprando lo que el anfitrion acababa de pausar: el
 * catalogo ya no lo ofrece, pero el checkout no mira el catalogo.
 *
 * Solo para lo que entra por el catalogo. Lo que el anfitrion carga a mano no
 * pasa por aqui: pausar es para dejar de recibir ventas de fuera, no para
 * atarse las manos.
 */
export async function comprobarEnPausa(
  experienceId: string,
  locationId?: string | null,
): Promise<void> {
  const { isPublished } = await condicionesDe(experienceId, locationId);
  if (isPublished) return;
  throw BadRequest('Esta experiencia no se está ofreciendo ahora mismo.', {
    motivo: 'EN_PAUSA',
  });
}

/**
 * Rechaza una compra a una hora que el anfitrion no abrio.
 *
 * Vale para las dos formas de no estar abierto: el dia que el patron semanal
 * no abre, y el dia suelto que se cerro a proposito —el 24, una boda, un
 * viaje—. Ninguna de las dos se comprobaba: el calendario del catalogo las
 * escondia y el checkout las vendia igual. Esconder no es cerrar.
 *
 * Si la experiencia no tiene ningun horario que aplique, no se exige nada: es
 * la que todavia no esta programada, y el catalogo ofrece las horas por
 * defecto. Poner una puerta ahi dejaria sin vender a quien aun no ha montado
 * su calendario.
 *
 * Solo para lo que entra por el catalogo. Lo que el anfitrion carga a mano
 * pasa: si decide abrir ese dia para un grupo concreto, es su negocio.
 */
export async function comprobarDiaAbierto(
  experienceId: string,
  fecha: Date,
  locationId?: string | null,
): Promise<void> {
  const horarios = await horariosQueAplican(experienceId, locationId);
  if (horarios.length === 0) return;

  const minuto = fecha.getHours() * 60 + fecha.getMinutes();
  const enMinutos = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };

  // Abierto si ALGUN horario de los que aplican cubre esa hora: con uno que la
  // abra, hay donde vender.
  const abierto = horarios.some((h) =>
    franjasDeLaFecha(h, fecha).some(
      (f) => minuto >= enMinutos(f.startTime) && minuto < enMinutos(f.endTime),
    ),
  );
  if (abierto) return;

  // Se distingue el dia cerrado a mano del que el patron no abre: el primero
  // es una decision que alguien tomo y conviene decirlo asi.
  const cerradoAMano = horarios.some((h) => fechaCerrada(h, fecha));
  throw BadRequest(
    cerradoAMano ? 'Ese día no está disponible.' : 'No hay horario disponible a esa hora.',
    { motivo: cerradoAMano ? 'FECHA_CERRADA' : 'FUERA_DE_HORARIO' },
  );
}
