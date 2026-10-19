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

type HorarioResumible = {
  weeklySchedule: unknown;
  dateOverrides?: unknown;
  validUntil?: Date | null;
};

/**
 * Los horarios que todavia rigen. Uno vencido no vende —al reservar no pone
 * cupos—, asi que contarlo aqui decia «abre los lunes» de algo que ya no abre.
 */
function vigentes<T extends HorarioResumible>(horarios: T[]): T[] {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return horarios.filter((h) => !h.validUntil || h.validUntil >= hoy);
}

function diasQueAbre(horarios: HorarioResumible[]): string[] {
  const abiertos = new Set<string>();
  const hoy = new Date();
  for (const h of vigentes(horarios)) {
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(hoy);
      d.setDate(d.getDate() + i);
      if (franjasDelDia(h.weeklySchedule, d).length > 0) {
        abiertos.add(DIAS[(d.getDay() + 6) % 7]!.corto);
      }
    }
  }
  return DIAS.filter((d) => abiertos.has(d.corto)).map((d) => d.corto);
}

/**
 * Cuantas franjas tiene puestas, para distinguir «sin horario» de «con uno».
 *
 * Cuentan el patron semanal de los horarios vigentes y las fechas sueltas que
 * abren de aqui en adelante: un horario que solo abre el 31 de diciembre vende,
 * aunque su semana este vacia.
 */
function cuantasFranjas(horarios: HorarioResumible[]): number {
  let n = 0;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  for (const h of vigentes(horarios)) {
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(hoy);
      d.setDate(d.getDate() + i);
      n += franjasDelDia(h.weeklySchedule, d).length;
    }
    const sueltas = h.dateOverrides;
    if (sueltas && typeof sueltas === 'object') {
      for (const [dia, v] of Object.entries(sueltas as Record<string, unknown>)) {
        const fecha = new Date(`${dia}T00:00:00`);
        if (Number.isNaN(fecha.getTime()) || fecha < hoy) continue;
        if (h.validUntil && fecha > h.validUntil) continue;
        const o = v as { isActive?: boolean; franjas?: unknown[]; timeSlots?: unknown[] };
        if (o?.isActive) n += (o.franjas ?? o.timeSlots ?? []).length;
      }
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
        atHome: p.atHome,
        featuredImage: p.featuredImage,
        duration: p.duration,
        completa: completitud.completa,
        falta: completitud.falta,
      };

      // A domicilio no se publica en sedes: la direccion la pone quien reserva.
      // Sale como una sola fila para que el catalogo la liste igual que las
      // demas, y para que su horario se pueda gestionar desde aqui.
      const sedes = p.atHome ? [] : p.locations;

      if (sedes.length === 0) {
        const horarios = await horariosQueAplican(p.id, null);
        // Sin sede tambien hay publicacion: la de a domicilio lleva la sede
        // nula y es la que se pausa y la que guarda sus condiciones.
        const suya = await prisma.locationListing.findFirst({
          where: { experienceId: p.id, locationId: null, deletedAt: null },
        });
        filas.push({
          ...comun,
          locationId: null,
          locationName: null,
          sedeActiva: null,
          propias: suya
            ? {
                kind: suya.kind,
                minCapacity: suya.minCapacity,
                basePrice: suya.basePrice,
                prepTime: suya.prepTime,
                cleanupTime: suya.cleanupTime,
                minimumNotice: suya.minimumNotice,
                isPublished: suya.isPublished,
                notes: suya.notes,
                cities: suya.cities,
              }
            : null,
          condiciones: await condicionesDe(p.id, null),
          diasQueAbre: diasQueAbre(horarios),
          franjas: cuantasFranjas(horarios),
          horarios: horarios.length,
        });
        continue;
      }

      // Lo que cada sede declara COMO SUYO, aparte de lo que acaba rigiendo.
      // Sin esta distinción la pantalla enseñaba el aforo heredado como si
      // fuera propio de la sede, y al abrir las condiciones lo convertía en
      // propio de verdad al guardar.
      const propias = await prisma.locationListing.findMany({
        where: { experienceId: p.id, deletedAt: null },
      });

      for (const s of sedes) {
        const horarios = await horariosQueAplican(p.id, s.id);
        const suyas = propias.find((f) => f.locationId === s.id) ?? null;
        filas.push({
          ...comun,
          locationId: s.id,
          locationName: s.name,
          sedeActiva: s.isActive,
          propias: suyas
            ? {
                kind: suyas.kind,
                minCapacity: suyas.minCapacity,
                basePrice: suyas.basePrice,
                prepTime: suyas.prepTime,
                cleanupTime: suyas.cleanupTime,
                minimumNotice: suyas.minimumNotice,
                isPublished: suyas.isPublished,
                notes: suyas.notes,
                cities: suyas.cities,
              }
            : null,
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
    locationId: string | null,
    condiciones: CondicionesDeSedeInput,
    companyId: string | null | undefined,
    opts?: { isAdmin?: boolean },
  ) {
    const exp = await prisma.experience.findFirst({
      where: { id: experienceId, deletedAt: null },
      select: { id: true, companyId: true, atHome: true },
    });
    if (!exp) throw NotFound('Experiencia no encontrada');
    if (!opts?.isAdmin && (!companyId || exp.companyId !== companyId)) {
      throw Forbidden('No puedes publicar una experiencia de otra empresa');
    }
    // A domicilio no hay sede: la direccion la pone quien reserva. Pero si hay
    // publicacion —lo que esta a la venta— con sus condiciones y su pausa, y
    // su fila lleva la sede nula.
    if (exp.atHome && locationId) {
      throw BadRequest(
        'Una experiencia a domicilio no se publica en una sede: la dirección la pone quien reserva.',
        { motivo: 'DOMICILIO_SIN_SEDE' },
      );
    }
    if (!exp.atHome && !locationId) {
      throw BadRequest('Esta experiencia se da en un sitio: dinos en cuál.', {
        motivo: 'FALTA_LA_SEDE',
      });
    }

    if (locationId) {
      // La sede tiene que ser de la MISMA empresa. Publicar en el local de otro
      // anfitrion mandaria gente a un sitio que no es suyo.
      const sede = await prisma.location.findFirst({
        where: { id: locationId, deletedAt: null, companyId: exp.companyId },
        select: { id: true },
      });
      if (!sede) {
        throw BadRequest('Esa sede no es de esta empresa.', { motivo: 'SEDE_AJENA' });
      }
    }


    // Las ciudades donde se presta, solo para la publicacion a domicilio. Si la
    // llamada no las trae se conservan las que ya tenia: pausar o cambiar el
    // precio no puede borrar la cobertura.
    const previa = await prisma.locationListing.findFirst({
      where: { experienceId, locationId: locationId ?? null },
      select: { id: true, cities: true },
    });
    const ciudades = exp.atHome
      ? [
          ...new Set(
            (condiciones.cities ?? previa?.cities ?? []).map((c) => c.trim()).filter(Boolean),
          ),
        ]
      : [];
    // Sin ciudades no hay catalogo que le toque: un chef a domicilio sin zona
    // se ofreceria a gente a la que no puede atender. Pausar si se deja, porque
    // es dejar de vender, no vender.
    if (exp.atHome && ciudades.length === 0 && condiciones.isPublished !== false) {
      throw BadRequest(
        'Una experiencia a domicilio necesita al menos una ciudad donde se presta.',
        { motivo: 'SIN_ZONAS' },
      );
    }

    const datos = {
      cities: ciudades,
      kind: condiciones.kind ?? null,
      minCapacity: condiciones.minCapacity ?? null,
      basePrice: condiciones.basePrice ?? null,
      prepTime: condiciones.prepTime ?? null,
      cleanupTime: condiciones.cleanupTime ?? null,
      minimumNotice: condiciones.minimumNotice ?? null,
      notes: condiciones.notes ?? null,
      ...(condiciones.isPublished === undefined ? {} : { isPublished: condiciones.isPublished }),
      deletedAt: null,
    };

    if (locationId) {
      await prisma.experience.update({
        where: { id: experienceId },
        data: { locations: { connect: { id: locationId } } },
      });
    }

    // Se busca antes de crear en vez de un upsert: con la sede nula el unico
    // de la base no sirve —Postgres trata los NULL como distintos— y dos
    // publicaciones de la misma experiencia a domicilio no tendrian sentido.
    if (previa) {
      await prisma.locationListing.update({ where: { id: previa.id }, data: datos });
    } else {
      await prisma.locationListing.create({
        data: { experienceId, locationId: locationId ?? null, ...datos },
      });
    }

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
    locationId: string | null,
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
        ...(locationId ? { locationId } : {}),
        status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        reservationDate: { gte: new Date() },
      },
    });

    await prisma.locationListing.deleteMany({ where: { experienceId, locationId: locationId ?? null } });
    // A domicilio no hay sede que desatar: solo se borra la publicacion.
    if (locationId) {
      await prisma.experience.update({
        where: { id: experienceId },
        data: { locations: { disconnect: { id: locationId } } },
      });
    }

    return { publicaciones: await this.publicaciones(exp.companyId), reservasPorVenir: porVenir };
  },
};
