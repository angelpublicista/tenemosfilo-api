// Hasta cuando se aceptan reservas (TR-06).
//
// El anfitrion define cuanta anticipacion necesita: comprar para una cena de
// quince personas no se hace a las seis de la tarde. Ese "aviso minimo" ya se
// guardaba en el horario y no lo leia nadie, asi que el catalogo seguia
// vendiendo la cena de esta noche.
//
// El requisito insiste en algo que es facil de pasar por alto: el corte vale
// tambien cuando se liberan cupos. Si alguien cancela dos horas antes, ese
// lugar NO vuelve al catalogo: el anfitrion ya compro para esa noche contando
// con la gente que tenia, y vender uno mas a esa hora le obliga a improvisar.
import { prisma } from '../config/prisma.js';
import { BadRequest } from './errors.js';

/**
 * El aviso minimo que aplica a una experiencia, en horas.
 *
 * Si tiene varios horarios, manda el mas exigente. Son suyos los dos y el
 * mayor es el que expresa de verdad cuanta anticipacion necesita; tomar el
 * menor dejaria entrar reservas que un horario rechaza.
 */
export async function horasDeAviso(experienceId: string): Promise<number> {
  const horarios = await prisma.availability.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      experiences: { some: { id: experienceId } },
    },
    select: { minimumNotice: true },
  });

  if (horarios.length > 0) return horarios.reduce((max, h) => Math.max(max, h.minimumNotice), 0);

  // Tambien valen los de la sede: una experiencia puede no tener horario
  // propio y colgar del de su sitio.
  const porSede = await prisma.availability.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      location: { experiences: { some: { id: experienceId } } },
    },
    select: { minimumNotice: true },
  });
  if (porSede.length > 0) return porSede.reduce((max, h) => Math.max(max, h.minimumNotice), 0);

  // TR-21. Y si no hay ni lo uno ni lo otro, la agenda propia del anfitrion:
  // un cocinero que va a casa del cliente no tiene sede, y su aviso minimo
  // esta ahi o no esta en ningun sitio.
  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { companyId: true },
  });
  if (!exp) return 0;

  const propias = await prisma.availability.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      companyId: exp.companyId,
      locationId: null,
      experiences: { none: {} },
    },
    select: { minimumNotice: true },
  });
  return propias.reduce((max, h) => Math.max(max, h.minimumNotice), 0);
}

/**
 * Rechaza una compra que llega demasiado tarde.
 *
 * Solo para lo que entra por el catalogo o por un canal. Una reserva que el
 * anfitrion carga a mano no pasa por aqui a proposito: si le llaman a las seis
 * y decide aceptar, es su negocio y ya sabe lo que hay en su cocina.
 */
export async function comprobarCorte(experienceId: string, fecha: Date): Promise<void> {
  const horas = await horasDeAviso(experienceId);
  if (horas <= 0) return;

  const limite = new Date(Date.now() + horas * 3_600_000);
  if (fecha >= limite) return;

  throw BadRequest(
    horas % 24 === 0 && horas >= 24
      ? `Esta experiencia se reserva con ${horas / 24} ${horas / 24 === 1 ? 'día' : 'días'} de anticipación.`
      : `Esta experiencia se reserva con ${horas} ${horas === 1 ? 'hora' : 'horas'} de anticipación.`,
    { motivo: 'FUERA_DE_PLAZO', horasDeAviso: horas },
  );
}
