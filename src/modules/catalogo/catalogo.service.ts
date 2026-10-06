// El catalogo publico: que experiencias se estan ofreciendo y donde.
//
// Una experiencia es una PIEZA —que se hace, cuanto dura, que incluye— y vive
// en su propio panel. El catalogo es otra cosa: es usarla. La misma pieza
// puede publicarse en el local del centro como abierta, con cupos sueltos los
// sabados, y en la finca como privada, por encargo y a otro precio.
//
// Esa pareja experiencia-sede es la PUBLICACION, y es la unidad con la que se
// arma el catalogo. Vive en `LocationListing`.
//
// Mezclar las dos cosas —la pieza y su publicacion— era el problema: todas las
// condiciones eran columnas de una sola fila de `Experience`, asi que la
// segunda sede heredaba a la fuerza las de la primera y no habia donde decir
// lo contrario.
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import {
  PARA_COMPLETITUD,
  completitudDeExperiencia,
} from '../../lib/completitud-de-experiencia.js';
import { condicionesDe } from '../../lib/sede-de-la-experiencia.js';
import { noDejarAforoCorto } from '../../lib/aforo-vendido.js';
import { franjasDelDia, horariosQueAplican } from '../../lib/franjas.js';
import type { CondicionesDeSedeInput } from '../experiences/experiences.schemas.js';

/** Las experiencias de la empresa y las sedes donde esta cada una. */
async function piezasYSedes(companyId: string) {
  return prisma.experience.findMany({
    where: { companyId, deletedAt: null },
    select: {
      // `PARA_COMPLETITUD` ya trae id, titulo, tipo y portada: se extiende con
      // lo que el catalogo necesita ademas, sin repetir sus claves.
      ...PARA_COMPLETITUD,
      slug: true,
      status: true,
      locations: {
        where: { deletedAt: null },
        select: { id: true, name: true, isMain: true, isActive: true },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
      },
    },
    orderBy: [{ title: 'asc' }],
  });
}

/**
 * Un resumen de los dias que ese horario abre, para enseñarlo de un vistazo.
 *
 * El catalogo no necesita el horario entero: necesita saber si hay algo
 * puesto. Una publicacion sin dias abiertos no vende nada aunque este activa,
 * y eso es lo que hay que poder ver sin entrar a mirar.
 */
const DIAS = [
  { clave: 'monday', corto: 'L' },
  { clave: 'tuesday', corto: 'M' },
  { clave: 'wednesday', corto: 'X' },
  { clave: 'thursday', corto: 'J' },
  { clave: 'friday', corto: 'V' },
  { clave: 'saturday', corto: 'S' },
  { clave: 'sunday', corto: 'D' },
] as const;

function diasQueAbre(horarios: Array<{ weeklySchedule: unknown }>): string[] {
  const abiertos = new Set<string>();
  for (const h of horarios) {
    const semana = h.weeklySchedule as Record<string, { isActive?: boolean }> | null;
    if (!semana) continue;
    for (const d of DIAS) {
      if (semana[d.clave]?.isActive) abiertos.add(d.corto);
    }
  }
  return DIAS.filter((d) => abiertos.has(d.corto)).map((d) => d.corto);
}

/** Cuantas franjas tiene puestas, para distinguir «sin horario» de «con uno». */
function cuantasFranjas(horarios: Array<{ weeklySchedule: unknown }>): number {
  let n = 0;
  const lunes = new Date();
  for (const h of horarios) {
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(lunes);
      d.setDate(d.getDate() + i);
      n += franjasDelDia(h.weeklySchedule, d).length;
    }
  }
  return n;
}

export const catalogoService = {
  /**
   * Lo que la empresa esta ofreciendo, publicacion por publicacion.
   *
   * Sale una fila por cada pareja experiencia-sede, con las condiciones ya
   * resueltas —las propias si las tiene, las de la experiencia si no— y el
   * horario que de verdad aplica alli. Es lo que hay que poder leer de un
   * golpe para saber si el catalogo esta en pie.
   *
   * Las experiencias sin ninguna sede salen igual, como «sin publicar»: son
   * las piezas creadas que todavia no se estan usando, y esconderlas seria
   * esconder justamente el trabajo que queda por hacer.
   */
  async publicaciones(companyId: string | null | undefined) {
    if (!companyId) throw Forbidden('No tienes una company asociada');

    const piezas = await piezasYSedes(companyId);
    const filas = [];

    for (const p of piezas) {
      const completitud = completitudDeExperiencia(p);
      const comun = {
        experienceId: p.id,
        title: p.title,
        slug: p.slug,
        status: p.status,
        experienceType: p.experienceType,
        isVirtual: p.isVirtual,
        featuredImage: p.featuredImage,
        duration: p.duration,
        completa: completitud.completa,
        falta: completitud.falta,
      };

      // Una virtual no se publica en sedes: se da donde sea. Sale como una
      // sola fila para que el catalogo la liste igual que las demas.
      const sedes = p.isVirtual || p.experienceType === 'VIRTUAL' ? [] : p.locations;

      if (sedes.length === 0) {
        const horarios = await horariosQueAplican(p.id, null);
        filas.push({
          ...comun,
          locationId: null,
          locationName: null,
          sedeActiva: null,
          condiciones: await condicionesDe(p.id, null),
          diasQueAbre: diasQueAbre(horarios),
          franjas: cuantasFranjas(horarios),
          horarios: horarios.length,
        });
        continue;
      }

      for (const s of sedes) {
        const horarios = await horariosQueAplican(p.id, s.id);
        filas.push({
          ...comun,
          locationId: s.id,
          locationName: s.name,
          sedeActiva: s.isActive,
          condiciones: await condicionesDe(p.id, s.id),
          diasQueAbre: diasQueAbre(horarios),
          franjas: cuantasFranjas(horarios),
          horarios: horarios.length,
        });
      }
    }

    return filas;
  },

  /**
   * Publica una experiencia en una sede, con sus condiciones.
   *
   * Si la sede todavia no estaba entre las de la experiencia, se ata aqui:
   * publicar ES ponerla en ese escenario, y pedir que antes alguien la hubiera
   * atado desde el panel de la pieza era justo la mezcla que se queria
   * deshacer.
   *
   * Las condiciones son opcionales y cada campo nulo hereda de la experiencia:
   * lo normal es publicar igual que la pieza y cambiar una cosa.
   */
  async publicar(
    experienceId: string,
    locationId: string,
    condiciones: CondicionesDeSedeInput,
    companyId: string | null | undefined,
    opts?: { isAdmin?: boolean },
  ) {
    const exp = await prisma.experience.findFirst({
      where: { id: experienceId, deletedAt: null },
      select: { id: true, companyId: true, isVirtual: true, experienceType: true },
    });
    if (!exp) throw NotFound('Experiencia no encontrada');
    if (!opts?.isAdmin && (!companyId || exp.companyId !== companyId)) {
      throw Forbidden('No puedes publicar una experiencia de otra empresa');
    }
    if (exp.isVirtual || exp.experienceType === 'VIRTUAL') {
      throw BadRequest('Una experiencia virtual no se publica en una sede.', {
        motivo: 'VIRTUAL_SIN_SEDE',
      });
    }

    // La sede tiene que ser de la MISMA empresa. Publicar en el local de otro
    // anfitrion mandaria gente a un sitio que no es suyo.
    const sede = await prisma.location.findFirst({
      where: { id: locationId, deletedAt: null, companyId: exp.companyId },
      select: { id: true },
    });
    if (!sede) {
      throw BadRequest('Esa sede no es de esta empresa.', { motivo: 'SEDE_AJENA' });
    }


    const datos = {
      kind: condiciones.kind ?? null,
      capacity: condiciones.capacity ?? null,
      minCapacity: condiciones.minCapacity ?? null,
      basePrice: condiciones.basePrice ?? null,
      prepTime: condiciones.prepTime ?? null,
      cleanupTime: condiciones.cleanupTime ?? null,
      minimumNotice: condiciones.minimumNotice ?? null,
      notes: condiciones.notes ?? null,
      ...(condiciones.isPublished === undefined ? {} : { isPublished: condiciones.isPublished }),
      deletedAt: null,
    };

    // TR-10. El aforo de esta sede tiene que caber en lo que ya esta vendido
    // aqui: bajarlo por debajo dejaria reservas que no entran en su propio
    // escenario. Se comprueba antes de tocar nada, para que una publicacion
    // rechazada no deje la sede atada a medias.
    await noDejarAforoCorto(experienceId, condiciones.capacity ?? undefined, locationId);

    await prisma.experience.update({
      where: { id: experienceId },
      data: { locations: { connect: { id: locationId } } },
    });

    await prisma.locationListing.upsert({
      where: { experienceId_locationId: { experienceId, locationId } },
      create: { experienceId, locationId, ...datos },
      update: datos,
    });

    return this.publicaciones(exp.companyId);
  },

  /**
   * Quita una experiencia de una sede.
   *
   * Se desata la sede y se borran sus condiciones: la pieza sigue existiendo y
   * se puede volver a publicar donde sea. Lo que no se toca son las reservas
   * ya vendidas alli —eso es historia, y reescribirla dejaria a gente con una
   * reserva en un sitio que la aplicacion dice que nunca existio—.
   */
  async quitar(
    experienceId: string,
    locationId: string,
    companyId: string | null | undefined,
    opts?: { isAdmin?: boolean },
  ) {
    const exp = await prisma.experience.findUnique({
      where: { id: experienceId },
      select: { companyId: true },
    });
    if (!exp) throw NotFound('Experiencia no encontrada');
    if (!opts?.isAdmin && (!companyId || exp.companyId !== companyId)) {
      throw Forbidden('No puedes cambiar el catálogo de otra empresa');
    }

    // Las reservas por venir en esa sede se avisan y no se tocan: quitarla del
    // catalogo cierra la venta futura, no cancela lo vendido.
    const porVenir = await prisma.reservation.count({
      where: {
        experienceId,
        locationId,
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        reservationDate: { gte: new Date() },
      },
    });

    await prisma.locationListing.deleteMany({ where: { experienceId, locationId } });
    await prisma.experience.update({
      where: { id: experienceId },
      data: { locations: { disconnect: { id: locationId } } },
    });

    return { publicaciones: await this.publicaciones(exp.companyId), reservasPorVenir: porVenir };
  },
};
