// Seguimientos comerciales automaticos.
//
// Regla que gobierna este archivo: crear un seguimiento nunca puede tumbar la
// operacion que lo origina. Si falla el recordatorio de un lead, el lead ya
// esta guardado; perder el recordatorio es molesto, perder el lead no se
// arregla. Por eso todo va envuelto en un catch, como los avisos de reserva.
import { prisma } from '../config/prisma.js';
import { logger } from './logger.js';

const HORA = 60 * 60 * 1000;

/** Cuando toca cada seguimiento de un lead, desde que entro la solicitud. */
const PLAZOS_DE_LEAD = [
  { kind: 'LEAD_24H' as const, horas: 24 },
  { kind: 'LEAD_48H' as const, horas: 48 },
  { kind: 'LEAD_72H' as const, horas: 72 },
];

/**
 * Cuando toca recordar una propuesta sin respuesta, desde que se envio.
 *
 * Tres y se para. Insistir mas alla de la semana ya no es seguimiento, y una
 * lista de pendientes que nunca se vacia deja de mirarse.
 */
const PLAZOS_DE_PROPUESTA = [
  { kind: 'PROPUESTA' as const, horas: 48 },
  { kind: 'PROPUESTA_3D' as const, horas: 24 * 3 },
  { kind: 'PROPUESTA_7D' as const, horas: 24 * 7 },
];

/** Los tipos que son seguimiento de propuesta, para retirarlos juntos. */
const TIPOS_DE_PROPUESTA = PLAZOS_DE_PROPUESTA.map((p) => p.kind);

/**
 * Si a este contacto se le puede escribir.
 *
 * Sin contacto se asume que si: la oportunidad existe y alguien tendra que
 * ocuparse de ella. Lo que no se hace es escribirle a quien pidio que no.
 */
async function sePuedeContactar(contactId: string | null | undefined): Promise<boolean> {
  if (!contactId) return true;
  const c = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { doNotContact: true },
  });
  return !c?.doNotContact;
}

/** Los tres seguimientos de un lead nuevo. */
export async function crearSeguimientosDeLead(
  opportunityId: string,
  contactId: string | null | undefined,
  desde = new Date(),
): Promise<void> {
  try {
    if (!(await sePuedeContactar(contactId))) return;
    await prisma.followup.createMany({
      data: PLAZOS_DE_LEAD.map((p) => ({
        opportunityId,
        kind: p.kind,
        dueAt: new Date(desde.getTime() + p.horas * HORA),
      })),
      // Si ya existen no se duplican: el unique de (oportunidad, tipo) lo
      // impide, y aqui se prefiere seguir adelante a romper por eso.
      skipDuplicates: true,
    });
  } catch (err) {
    logger.error({ err, opportunityId }, 'no se pudieron crear los seguimientos del lead');
  }
}

/**
 * El seguimiento de una propuesta enviada.
 *
 * Ademas retira los del lead: ya no hay nada que perseguir —el cliente recibio
 * lo que necesitaba— y dejarlos llenaria la lista de pendientes con trabajo
 * que ya se hizo.
 */
export async function crearSeguimientoDePropuesta(
  opportunityId: string,
  contactId: string | null | undefined,
  desde = new Date(),
): Promise<void> {
  try {
    await prisma.followup.updateMany({
      where: {
        opportunityId,
        status: 'PENDIENTE',
        kind: { in: ['LEAD_24H', 'LEAD_48H', 'LEAD_72H'] },
      },
      data: { status: 'NO_APLICA' },
    });

    if (!(await sePuedeContactar(contactId))) return;

    // upsert y no create: reenviar una propuesta reinicia los tres plazos en
    // vez de dejar vencidos los de hace dos semanas.
    for (const p of PLAZOS_DE_PROPUESTA) {
      const dueAt = new Date(desde.getTime() + p.horas * HORA);
      await prisma.followup.upsert({
        where: { opportunityId_kind: { opportunityId, kind: p.kind } },
        create: { opportunityId, kind: p.kind, dueAt },
        update: { dueAt, status: 'PENDIENTE', doneAt: null },
      });
    }
  } catch (err) {
    logger.error({ err, opportunityId }, 'no se pudo crear el seguimiento de la propuesta');
  }
}

/**
 * Da por cumplidos los recordatorios de propuesta posteriores a uno.
 *
 * Marcar "hecho" el de las 48 h es decir que ya se hablo con el cliente. Los
 * del dia 3 y el 7 perseguian esa misma respuesta, asi que dejarlos vivos
 * seria pedir tres veces el mismo trabajo.
 */
export async function retirarPropuestasPosteriores(
  opportunityId: string,
  kind: string,
): Promise<void> {
  const i = TIPOS_DE_PROPUESTA.indexOf(kind as (typeof TIPOS_DE_PROPUESTA)[number]);
  if (i < 0) return;
  const posteriores = TIPOS_DE_PROPUESTA.slice(i + 1);
  if (posteriores.length === 0) return;
  try {
    await prisma.followup.updateMany({
      where: { opportunityId, status: 'PENDIENTE', kind: { in: posteriores } },
      data: { status: 'NO_APLICA' },
    });
  } catch (err) {
    logger.error({ err, opportunityId }, 'no se pudieron retirar las propuestas posteriores');
  }
}

/**
 * Retira los seguimientos pendientes de una oportunidad.
 *
 * Se usa al cerrarla —ganada o perdida— y cuando el contacto pide no ser
 * molestado. No se borran: NO_APLICA deja constancia de que existieron y de
 * por que dejaron de hacer falta.
 */
export async function retirarSeguimientos(opportunityId: string): Promise<void> {
  try {
    await prisma.followup.updateMany({
      where: { opportunityId, status: 'PENDIENTE' },
      data: { status: 'NO_APLICA' },
    });
  } catch (err) {
    logger.error({ err, opportunityId }, 'no se pudieron retirar los seguimientos');
  }
}

/** Lo mismo, para todas las oportunidades de un contacto que pidio no ser molestado. */
export async function retirarSeguimientosDelContacto(contactId: string): Promise<void> {
  try {
    await prisma.followup.updateMany({
      where: { status: 'PENDIENTE', opportunity: { contactId } },
      data: { status: 'NO_APLICA' },
    });
  } catch (err) {
    logger.error({ err, contactId }, 'no se pudieron retirar los seguimientos del contacto');
  }
}
