// TR-10. El aforo no puede quedar por debajo de lo ya vendido.
//
// Vive aparte porque se toca desde dos sitios —al editar la experiencia y al
// publicarla en una sede— y la comprobacion tiene que ser la misma. Cuando
// estaba dentro del servicio de experiencias, el catalogo bajaba el aforo de
// una sede sin que nada mirara lo que ya habia vendido alli.
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';

/**
 * TR-10. No se puede dejar el aforo por debajo de lo ya vendido.
 *
 * Bajar la capacidad de una experiencia con reservas encima deja el dia
 * sobrevendido sin que nada avise: la gente ya pago y las plazas dejan de
 * existir. Se mira dia por dia, porque el aforo es por dia: que el total del
 * mes quepa no sirve de nada si un sabado no cabe.
 *
 * Solo cuentan los dias que estan por venir. Reducir el aforo no reescribe
 * lo que ya paso, y un sabado del año pasado con mas gente de la que cabe
 * ahora no es un problema que arreglar.
 *
 * Con `locationId` se mira el aforo de ESA sede, y solo cuentan las reservas
 * que caen ahi: bajar el aforo de la finca no tiene por que tropezar con lo
 * que se vendio en el local del centro. Las reservas sin sede cuentan en todas
 * porque no se puede saber donde caen, y dejarlas fuera dejaria un dia
 * sobrevendido sin que nada avise.
 */
export async function noDejarAforoCorto(
  experienceId: string,
  nuevoAforo: number | undefined,
  locationId?: string | null,
): Promise<void> {
  if (!nuevoAforo || nuevoAforo <= 0) return;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const sedes = locationId
    ? await prisma.location.count({
        where: { deletedAt: null, experiences: { some: { id: experienceId } } },
      })
    : 0;

  const porDia = await prisma.reservation.groupBy({
    by: ['reservationDate'],
    where: {
      experienceId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      reservationDate: { gte: hoy },
      ...(locationId && sedes > 1 ? { OR: [{ locationId }, { locationId: null }] } : {}),
    },
    _sum: { participants: true },
  });

  // Las reservas del mismo dia pueden tener horas distintas, asi que se
  // suman por fecha natural: el aforo se cuenta por dia, no por hora.
  const ocupado = new Map<string, number>();
  for (const f of porDia) {
    const clave = f.reservationDate.toISOString().slice(0, 10);
    ocupado.set(clave, (ocupado.get(clave) ?? 0) + (f._sum?.participants ?? 0));
  }

  let peorDia: string | null = null;
  let peorCuenta = 0;
  for (const [clave, cuenta] of ocupado) {
    if (cuenta > nuevoAforo && cuenta > peorCuenta) {
      peorDia = clave;
      peorCuenta = cuenta;
    }
  }

  if (peorDia) {
    const [a, m, d] = [peorDia.slice(0, 4), peorDia.slice(5, 7), peorDia.slice(8, 10)];
    throw BadRequest(
      `No puedes bajar el aforo${locationId ? ' de esa sede' : ''} a ${nuevoAforo}: el ${d}/${m}/${a} ya tienes ` +
        `${peorCuenta} personas reservadas. Cancela o reagenda esas reservas primero.`,
    );
  }
}
