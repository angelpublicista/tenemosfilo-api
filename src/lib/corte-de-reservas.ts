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
 * El aviso minimo de una experiencia, en horas.
 *
 * Vive en la experiencia y no en el horario: la anticipacion que necesita una
 * cena de quince personas es de la cena, no del sabado. Un mismo horario sirve
 * a experiencias que necesitan avisos muy distintos, y cuando el dato estaba
 * ahi habia que elegir entre ellas.
 */
export async function horasDeAviso(experienceId: string): Promise<number> {
  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { minimumNotice: true },
  });
  return exp?.minimumNotice ?? 0;
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
