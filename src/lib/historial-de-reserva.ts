// El historial de una reserva (TR-39).
//
// Editar o reagendar conserva el mismo id y el mismo numero: es la misma
// reserva. Eso solo sirve de algo si se puede ver que le fue pasando — "la
// movieron dos veces y al final se cayo" era imposible de reconstruir, y es
// justo lo que hay que saber cuando un cliente llama a reclamar.
//
// Se guarda quien lo hizo por su email y no por su id: el historial debe
// seguir contando lo que paso aunque ese usuario se borre despues.

export interface CambioDeReserva {
  fecha: string;
  /** Quien lo hizo, tal como estaba entonces. */
  quien: string | null;
  campo: string;
  antes: string | null;
  despues: string | null;
  motivo?: string | null;
}

export interface Actor {
  id?: string | null;
  email?: string | null;
}

export function cambio(
  campo: string,
  antes: unknown,
  despues: unknown,
  actor?: Actor,
  motivo?: string | null,
): CambioDeReserva {
  const texto = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };
  return {
    fecha: new Date().toISOString(),
    quien: actor?.email ?? null,
    campo,
    antes: texto(antes),
    despues: texto(despues),
    ...(motivo ? { motivo } : {}),
  };
}

/**
 * Los campos cuyo cambio se guarda en el historial.
 *
 * No todos: `updatedAt` se mueve siempre y guardarlo seria ruido. Lo que entra
 * es lo que alguien podria tener que explicar despues.
 */
export const CAMPOS_CON_HISTORIAL = [
  'reservationDate',
  'participants',
  'locationId',
  'status',
  'paymentStatus',
  'duration',
  'specialRequirements',
] as const;
