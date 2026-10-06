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
  /** El inventario de esta franja. Null = el aforo de la experiencia. */
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
 * Los horarios activos que aplican a una experiencia, en orden de prioridad.
 *
 * Los suyos mandan; si no tiene, los de su sede; si tampoco, la agenda propia
 * del anfitrion (TR-21). Devuelve el primer nivel que exista, no la union:
 * un horario propio esta ahi justamente para no usar el general.
 */
export async function horariosQueAplican(experienceId: string) {
  const propios = await prisma.availability.findMany({
    where: { deletedAt: null, isActive: true, experiences: { some: { id: experienceId } } },
    select: { id: true, weeklySchedule: true, validFrom: true, validUntil: true, blockedDates: true },
  });
  if (propios.length > 0) return propios;

  const porSede = await prisma.availability.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      location: { experiences: { some: { id: experienceId } } },
    },
    select: { id: true, weeklySchedule: true, validFrom: true, validUntil: true, blockedDates: true },
  });
  if (porSede.length > 0) return porSede;

  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { companyId: true },
  });
  if (!exp) return [];

  return prisma.availability.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      companyId: exp.companyId,
      locationId: null,
      experiences: { none: {} },
    },
    select: { id: true, weeklySchedule: true, validFrom: true, validUntil: true, blockedDates: true },
  });
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
 * La franja con cupos propios en la que cae una reserva, si la hay.
 *
 * Devuelve null cuando no hay ninguna o cuando la que aplica no define cupos:
 * en ese caso el aforo es el de la experiencia y se cuenta por dia, como
 * siempre. Asi, a quien no use cupos por franja no le cambia nada.
 *
 * Si dos horarios cubren la misma hora con cupos distintos, manda el menor:
 * es el unico que no promete sitio que el otro no tiene.
 */
export async function franjaDeLaReserva(
  experienceId: string,
  fecha: Date,
): Promise<FranjaConCupos | null> {
  const horarios = await horariosQueAplican(experienceId);
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
