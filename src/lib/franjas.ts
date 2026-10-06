// Las franjas horarias que aplican a una experiencia.
//
// Una franja es el rango del dia en que pueden empezar sesiones, y desde
// ahora lleva sus propios cupos: el almuerzo y la cena de un sabado son dos
// inventarios distintos y se llenan por separado. Sin cupos propios manda el
// aforo de la experiencia, que es como venia funcionando.
//
// La cascada de donde salen los horarios —los suyos, los de su sede, o la
// agenda del anfitrion— vive aqui y no repetida en cada sitio: cuando se
// repetia, el corte de anticipacion y el conteo de cupos miraban horarios
// distintos sin que nadie se diera cuenta.
import { prisma } from '../config/prisma.js';

const DIAS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export interface Franja {
  startTime: string;
  endTime: string;
  /**
   * El inventario de esta franja. Los cupos son del horario, no de la
   * experiencia: el almuerzo y la cena de un sabado se llenan por separado.
   *
   * Nulo solo en horarios anteriores a la regla; entonces esa franja no pone
   * limite, que es lo que hacia una experiencia sin aforo.
   */
  cupos?: number | null;
}

interface DiaDeLaSemana {
  isActive?: boolean;
  franjas?: Franja[];
  /** Horarios guardados antes del renombre. Se leen igual. */
  timeSlots?: Franja[];
}

/** Las franjas de un dia, vengan con el nombre nuevo o con el viejo. */
export function franjasDelDia(semana: unknown, fecha: Date): Franja[] {
  if (!semana || typeof semana !== 'object') return [];
  const clave = DIAS[fecha.getDay()];
  const dia = (semana as Record<string, DiaDeLaSemana | undefined>)[clave!];
  if (!dia?.isActive) return [];
  return dia.franjas ?? dia.timeSlots ?? [];
}

/**
 * El grupo mas grande que cabe en alguna franja de estos horarios.
 *
 * Los cupos son de la franja, asi que "cuanta gente cabe" ya no es un numero
 * de la experiencia: es el mayor de sus franjas. Sirve para las fichas que
 * tienen que decir un maximo —los canales de venta— sin volver a inventarse
 * un aforo en la experiencia.
 *
 * `null` cuando ninguna franja declara cupos: entonces no hay maximo que
 * prometer.
 */
export function aforoMaximo(horarios: Array<{ weeklySchedule: unknown }>): number | null {
  let mayor: number | null = null;
  const lunes = new Date();
  for (const h of horarios) {
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(lunes);
      d.setDate(d.getDate() + i);
      for (const f of franjasDelDia(h.weeklySchedule, d)) {
        if (f.cupos === null || f.cupos === undefined) continue;
        if (mayor === null || f.cupos > mayor) mayor = f.cupos;
      }
    }
  }
  return mayor;
}

/**
 * Los horarios activos que aplican a una experiencia en una sede, por orden
 * de prioridad.
 *
 * Los suyos en ESA sede mandan; si no tiene, los suyos sin sede —que valen
 * para todas—; si tampoco, los de la sede; y de ultimo la agenda propia del
 * anfitrion (TR-21). Devuelve el primer nivel que exista, no la union: un
 * horario propio esta ahi justamente para no usar el general.
 *
 * La sede importa porque la misma experiencia puede estar en dos sitios con
 * condiciones distintas: abierta los sabados en el local y solo por encargo en
 * la finca. Sin filtrar por sede, los dos calendarios se sumaban y en la finca
 * aparecian sabados que nadie habia abierto alli.
 *
 * Sin `locationId` se asume la sede cuando hay una sola —no hay ambiguedad que
 * resolver— y si hay varias se mira todo, que es como venia funcionando.
 */
export async function horariosQueAplican(experienceId: string, locationId?: string | null) {
  const sede = locationId ?? (await sedeUnica(experienceId));
  const seleccion = {
    id: true,
    weeklySchedule: true,
    validFrom: true,
    validUntil: true,
    blockedDates: true,
  } as const;
  const vivos = { deletedAt: null, isActive: true } as const;
  const suyos = { experiences: { some: { id: experienceId } } } as const;

  if (sede) {
    const propiosDeLaSede = await prisma.availability.findMany({
      where: { ...vivos, ...suyos, locationId: sede },
      select: seleccion,
    });
    if (propiosDeLaSede.length > 0) return propiosDeLaSede;

    const propiosSinSede = await prisma.availability.findMany({
      where: { ...vivos, ...suyos, locationId: null },
      select: seleccion,
    });
    if (propiosSinSede.length > 0) return propiosSinSede;

    // El horario DE LA SEDE es el que no es de ninguna experiencia en
    // particular. Uno atado a otra experiencia no vale aqui: cuando valia, el
    // taller de panaderia heredaba los cupos del horario de la cata solo por
    // estar en el mismo local, y se quedaba sin sitio sin que nadie entendiera
    // por que.
    const deLaSede = await prisma.availability.findMany({
      where: { ...vivos, locationId: sede, experiences: { none: {} } },
      select: seleccion,
    });
    if (deLaSede.length > 0) return deLaSede;
  } else {
    const propios = await prisma.availability.findMany({
      where: { ...vivos, ...suyos },
      select: seleccion,
    });
    if (propios.length > 0) return propios;

    const porSede = await prisma.availability.findMany({
      where: {
        ...vivos,
        location: { experiences: { some: { id: experienceId } } },
        // Igual que arriba: el de la sede, no el de otra experiencia suya.
        experiences: { none: {} },
      },
      select: seleccion,
    });
    if (porSede.length > 0) return porSede;
  }

  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { companyId: true },
  });
  if (!exp) return [];

  return prisma.availability.findMany({
    where: {
      ...vivos,
      companyId: exp.companyId,
      locationId: null,
      experiences: { none: {} },
    },
    select: seleccion,
  });
}

/**
 * La sede que se da por supuesta cuando nadie la nombra: la unica que hay.
 *
 * Duplica a proposito la de `sede-de-la-experiencia.ts`: importarla crearia un
 * ciclo entre los dos modulos y son cuatro lineas.
 */
async function sedeUnica(experienceId: string): Promise<string | null> {
  const sedes = await prisma.location.findMany({
    where: { deletedAt: null, experiences: { some: { id: experienceId } } },
    select: { id: true },
    take: 2,
  });
  return sedes.length === 1 ? sedes[0]!.id : null;
}

const enMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export interface FranjaConCupos {
  inicio: Date;
  fin: Date;
  cupos: number;
}

/**
 * La franja en la que cae una reserva, con sus cupos.
 *
 * Devuelve null cuando no hay ninguna que cubra esa hora, o cuando la que
 * aplica no declara cupos —horarios anteriores a la regla—: entonces no hay
 * inventario contra que comparar y no se limita.
 *
 * Si dos horarios cubren la misma hora con cupos distintos, manda el menor:
 * es el unico que no promete sitio que el otro no tiene.
 */
export async function franjaDeLaReserva(
  experienceId: string,
  fecha: Date,
  locationId?: string | null,
): Promise<FranjaConCupos | null> {
  const horarios = await horariosQueAplican(experienceId, locationId);
  if (horarios.length === 0) return null;

  const minutoDeLaReserva = fecha.getHours() * 60 + fecha.getMinutes();
  const dia = new Date(fecha);
  dia.setHours(0, 0, 0, 0);

  let elegida: FranjaConCupos | null = null;

  for (const h of horarios) {
    // La vigencia del horario cuenta: uno que ya no rige no pone cupos.
    const soloElDia = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}-${String(
      dia.getDate(),
    ).padStart(2, '0')}`;
    if (h.validFrom && soloElDia < h.validFrom.toISOString().slice(0, 10)) continue;
    if (h.validUntil && dia > h.validUntil) continue;

    for (const f of franjasDelDia(h.weeklySchedule, fecha)) {
      if (f.cupos === null || f.cupos === undefined) continue;
      const desde = enMinutos(f.startTime);
      const hasta = enMinutos(f.endTime);
      if (minutoDeLaReserva < desde || minutoDeLaReserva >= hasta) continue;

      const inicio = new Date(dia);
      inicio.setMinutes(desde);
      const fin = new Date(dia);
      fin.setMinutes(hasta);

      if (!elegida || f.cupos < elegida.cupos) elegida = { inicio, fin, cupos: f.cupos };
    }
  }

  return elegida;
}
