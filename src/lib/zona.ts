// La hora de las reservas es la hora de Bogota, no la del servidor.
//
// El front manda la reserva como instante (ISO en UTC) y los horarios se
// guardan en hora de pared ("14:00"). Leer `getHours()` en el servidor
// compara esa hora con la del reloj de la maquina: en UTC, las 14:00 de
// Bogota llegaban como las 19:00 y una sesion fija de las 14:00 se rechazaba
// como fuera de horario. Bogota no tiene horario de verano: es UTC-5 fijo.

const OFFSET_MS = -5 * 3_600_000;
const DIA_MS = 24 * 3_600_000;

export interface FechaEnBogota {
  anio: number;
  /** 1-12. */
  mes: number;
  dia: number;
  /** 0 = domingo, como `Date#getDay`. */
  diaSemana: number;
  /** Minutos desde la medianoche de Bogota. */
  minuto: number;
}

export function enBogota(f: Date): FechaEnBogota {
  const s = new Date(f.getTime() + OFFSET_MS);
  return {
    anio: s.getUTCFullYear(),
    mes: s.getUTCMonth() + 1,
    dia: s.getUTCDate(),
    diaSemana: s.getUTCDay(),
    minuto: s.getUTCHours() * 60 + s.getUTCMinutes(),
  };
}

/** La medianoche de Bogota del dia en que cae esa fecha. */
export function inicioDelDiaEnBogota(f: Date): Date {
  const { anio, mes, dia } = enBogota(f);
  return new Date(Date.UTC(anio, mes - 1, dia) - OFFSET_MS);
}

/** Sumar dias enteros: sin horario de verano, un dia son siempre 24 h. */
export function sumarDias(f: Date, dias: number): Date {
  return new Date(f.getTime() + dias * DIA_MS);
}

/** "YYYY-MM-DD" del dia de Bogota, que es como se guardan las excepciones. */
export function claveDelDiaEnBogota(f: Date): string {
  const { anio, mes, dia } = enBogota(f);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
