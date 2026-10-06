// TR-10. Los cupos no pueden quedar por debajo de lo ya vendido.
//
// Vive aparte porque el aforo es de la FRANJA y se toca al guardar un horario,
// que es un sitio distinto de donde se vende. Bajar los cupos de un sabado con
// gente dentro deja el dia sobrevendido sin que nada avise: la gente ya pago y
// las plazas dejan de existir.
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';
import { franjasDelDia } from './franjas.js';

const DIAS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const enMinutos = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const soloElDia = (f: Date) =>
  `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;

/**
 * Las experiencias a las que afecta un horario.
 *
 * Las suyas si las tiene; si no, las de su sede, que es a quienes sirve. Mas
 * alla no hace falta mirar: un horario sin sede ni experiencias es la agenda
 * del anfitrion y no pone cupos a nadie.
 */
async function aQuienAfecta(availabilityId: string): Promise<string[]> {
  const h = await prisma.availability.findUnique({
    where: { id: availabilityId },
    select: {
      locationId: true,
      experiences: { select: { id: true } },
    },
  });
  if (!h) return [];
  if (h.experiences.length > 0) return h.experiences.map((e) => e.id);
  if (!h.locationId) return [];
  const deLaSede = await prisma.experience.findMany({
    where: { deletedAt: null, locations: { some: { id: h.locationId } } },
    select: { id: true },
  });
  return deLaSede.map((e) => e.id);
}

/**
 * Rechaza bajar los cupos de una franja por debajo de lo ya vendido en ella.
 *
 * Solo mira los dias que estan por venir: reducir el aforo no reescribe lo que
 * ya paso, y un sabado del año pasado con mas gente de la que cabe ahora no es
 * un problema que arreglar.
 */
export async function noBajarCuposVendidos(
  availabilityId: string,
  nuevaSemana: unknown,
): Promise<void> {
  const experiencias = await aQuienAfecta(availabilityId);
  if (experiencias.length === 0) return;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const reservas = await prisma.reservation.findMany({
    where: {
      experienceId: { in: experiencias },
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      reservationDate: { gte: hoy },
    },
    select: { reservationDate: true, participants: true },
  });
  if (reservas.length === 0) return;

  // Cuanta gente hay vendida en cada (dia, franja). Se agrupa por el dia
  // natural y el rango de la franja porque es asi como se cuenta al vender.
  const vendido = new Map<string, number>();
  for (const r of reservas) {
    const clave = DIAS[r.reservationDate.getDay()];
    const minuto = r.reservationDate.getHours() * 60 + r.reservationDate.getMinutes();
    for (const f of franjasDelDia(nuevaSemana, r.reservationDate)) {
      if (f.cupos === null || f.cupos === undefined) continue;
      if (minuto < enMinutos(f.startTime) || minuto >= enMinutos(f.endTime)) continue;
      const k = `${soloElDia(r.reservationDate)}|${clave}|${f.startTime}-${f.endTime}|${f.cupos}`;
      vendido.set(k, (vendido.get(k) ?? 0) + r.participants);
    }
  }

  for (const [k, cuenta] of vendido) {
    const [fecha, , rango, cuposTexto] = k.split('|');
    const cupos = Number(cuposTexto);
    if (cuenta <= cupos) continue;
    const [a, m, d] = [fecha!.slice(0, 4), fecha!.slice(5, 7), fecha!.slice(8, 10)];
    throw BadRequest(
      `No puedes dejar ${cupos} cupos en la franja de ${rango}: el ${d}/${m}/${a} ya tienes ` +
        `${cuenta} personas reservadas en ella. Cancela o reagenda esas reservas primero.`,
      { motivo: 'CUPOS_POR_DEBAJO_DE_LO_VENDIDO' },
    );
  }
}
