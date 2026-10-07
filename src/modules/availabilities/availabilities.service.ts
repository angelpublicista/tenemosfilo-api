import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { noBajarCuposVendidos } from '../../lib/aforo-vendido.js';
import type {
  CreateAvailabilityInput,
  ListAvailabilitiesQuery,
  SetPrimaryInput,
  UpdateAvailabilityInput,
} from './availabilities.schemas.js';

const baseInclude = {
  location: { select: { id: true, name: true, slug: true, companyId: true } },
} satisfies Prisma.AvailabilityInclude;

async function locationCompanyId(locationId: string): Promise<string | null> {
  const loc = await prisma.location.findFirst({
    where: { id: locationId, deletedAt: null },
    select: { companyId: true },
  });
  return loc?.companyId ?? null;
}

/**
 * TR-37. Una sede inactiva no admite programaciones nuevas.
 *
 * Desactivar una sede es decir "aqui ya no". Lo que no hace es cancelar lo que
 * ya estaba vendido alli: eso lo decide el anfitrion reserva por reserva, y
 * cancelar en bloque por un ajuste de ficha seria pasarse.
 */
async function sedeAdmiteProgramacion(locationId: string): Promise<void> {
  const loc = await prisma.location.findFirst({
    where: { id: locationId, deletedAt: null },
    select: { isActive: true, name: true },
  });
  if (loc && !loc.isActive) {
    throw BadRequest(
      `${loc.name} está inactiva: actívala antes de programar horarios en ella.`,
      { motivo: 'SEDE_INACTIVA' },
    );
  }
}

async function experienceCompanyId(experienceId: string): Promise<string | null> {
  const exp = await prisma.experience.findFirst({
    where: { id: experienceId, deletedAt: null },
    select: { companyId: true },
  });
  return exp?.companyId ?? null;
}

/** Las 00:00 de un dia dado en "YYYY-MM-DD" o una fecha ISO completa. */
function inicioDelDia(v: string): Date {
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * El final de un dia.
 *
 * Una vigencia "hasta el 31 de diciembre" incluye el 31 de diciembre: cortar
 * a las 00:00 de ese dia dejaria fuera el ultimo dia que el anfitrion dijo
 * que abria.
 */
function finDelDia(v: string): Date {
  const d = new Date(v.length <= 10 ? `${v}T00:00:00` : v);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Normaliza el horario a `franjas`.
 *
 * Un cliente viejo puede seguir mandando `timeSlots`; lo que se guarda es
 * `franjas`, una sola forma. Aceptar las dos al escribir y guardar una sola
 * es lo que evita que la base acabe con las dos conviviendo.
 */
function aFranjas(semana: unknown): unknown {
  if (!semana || typeof semana !== 'object') return semana;
  const salida: Record<string, unknown> = {};
  for (const [dia, valor] of Object.entries(semana as Record<string, unknown>)) {
    if (!valor || typeof valor !== 'object') {
      salida[dia] = valor;
      continue;
    }
    const d = valor as { isActive?: boolean; franjas?: unknown[]; timeSlots?: unknown[] };
    salida[dia] = {
      isActive: d.isActive ?? false,
      franjas: d.franjas ?? d.timeSlots ?? [],
    };
  }
  return salida;
}

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const av = await prisma.availability.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      companyId: true,
      locationId: true,
      location: { select: { companyId: true } },
      experiences: { select: { companyId: true } },
    },
  });
  if (!av) throw NotFound('Disponibilidad no encontrada');
  if (!requesterCompanyId) throw Forbidden('No tienes una company asociada');

  // TR-21. El dueño explicito manda; la sede y las experiencias siguen
  // valiendo para los horarios de antes de que existiera `companyId`.
  const allCompanyIds = new Set<string>();
  if (av.companyId) allCompanyIds.add(av.companyId);
  if (av.location?.companyId) allCompanyIds.add(av.location.companyId);
  for (const e of av.experiences) allCompanyIds.add(e.companyId);
  if (allCompanyIds.size > 0 && !allCompanyIds.has(requesterCompanyId)) {
    throw Forbidden('No tienes permiso sobre esta disponibilidad');
  }
  return av;
}

/**
 * Las tres formas en que un horario es de una empresa.
 *
 * Por dueño directo —la agenda propia, TR-21—, por su sede, o por alguna
 * experiencia atada. Las dos ultimas siguen valiendo para los horarios
 * creados antes de que `companyId` existiera.
 */
function deLaEmpresa(companyId: string): Prisma.AvailabilityWhereInput[] {
  return [
    { companyId },
    { location: { companyId } },
    { experiences: { some: { companyId } } },
  ];
}

export const availabilitiesService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateAvailabilityInput) {
    if (!requesterCompanyId) throw Forbidden('No tienes una company asociada');

    if (input.location) {
      const cid = await locationCompanyId(input.location);
      if (!cid) throw NotFound('Location no encontrada');
      if (cid !== requesterCompanyId) throw Forbidden('La location no pertenece a tu company');
      await sedeAdmiteProgramacion(input.location);
    }
    if (input.experience) {
      const cid = await experienceCompanyId(input.experience);
      if (!cid) throw NotFound('Experiencia no encontrada');
      if (cid !== requesterCompanyId) throw Forbidden('La experiencia no pertenece a tu company');
    }

    if (finDelDia(input.validUntil) < inicioDelDia(input.validFrom)) {
      throw BadRequest('La fecha final del horario no puede ser anterior a la de inicio.');
    }

    return prisma.availability.create({
      data: {
        // TR-21. Siempre con dueño. Sin sede y sin experiencia, este horario
        // ES la agenda del anfitrion: el calendario de un cocinero que va a
        // casa del cliente no es de ninguna sede ni de una experiencia suelta.
        company: { connect: { id: requesterCompanyId } },
        name: input.name,
        description: input.description ?? null,
        weeklySchedule: aFranjas(input.weeklySchedule) as Prisma.InputJsonValue,
        // `blockedDates` ya no se escribe: lo que pasa en una fecha vive en
        // `dateOverrides`, que ademas sabe abrir un dia suelto.
        ...(input.dateOverrides
          ? { dateOverrides: input.dateOverrides as Prisma.InputJsonValue }
          : {}),
        // TR-35. La vigencia del horario. El inicio a las 00:00 y el final al
        // acabar ese dia: una vigencia "hasta el 31 de diciembre" incluye el
        // 31 de diciembre.
        validFrom: inicioDelDia(input.validFrom),
        validUntil: finDelDia(input.validUntil),
        notes: input.notes ?? null,
        isMain: input.isMain ?? false,
        isActive: input.isActive ?? true,
        ...(input.location ? { location: { connect: { id: input.location } } } : {}),
        ...(input.experience
          ? { experiences: { connect: [{ id: input.experience }] } }
          : {}),
      },
      include: baseInclude,
    });
  },

  async getById(
    id: string,
    requesterCompanyId: string | null | undefined,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;
    if (!crossCompany) {
      await assertCanManage(id, requesterCompanyId);
    }
    const av = await prisma.availability.findFirst({
      where: { id, deletedAt: null, ...(crossCompany ? { isActive: true } : {}) },
      include: baseInclude,
    });
    if (!av) throw NotFound('Disponibilidad no encontrada');
    return av;
  },

  async list(
    requesterCompanyId: string | null | undefined,
    query: ListAvailabilitiesQuery,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;

    const where: Prisma.AvailabilityWhereInput = {
      deletedAt: null,
      ...(crossCompany ? { isActive: true } : {}),
      ...(query.primaryOnly ? { isMain: true, isActive: true } : {}),
      ...(query.locationId ? { locationId: query.locationId } : {}),
      ...(query.experienceId ? { experiences: { some: { id: query.experienceId } } } : {}),
      // TR-21. La agenda propia del anfitrion: sin sede y sin experiencias.
      ...(query.soloPropias
        ? { locationId: null, experiences: { none: {} } }
        : {}),
      ...(query.companyId
        ? { OR: deLaEmpresa(query.companyId) }
        : crossCompany
          ? {}
          : requesterCompanyId
            ? { OR: deLaEmpresa(requesterCompanyId) }
            : {}),
    };

    return prisma.availability.findMany({
      where,
      include: baseInclude,
      orderBy: [{ isMain: 'desc' }, { createdAt: 'desc' }],
    });
  },

  async update(id: string, requesterCompanyId: string | null | undefined, input: UpdateAvailabilityInput) {
    await assertCanManage(id, requesterCompanyId);

    const data: Prisma.AvailabilityUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isMain !== undefined) data.isMain = input.isMain;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.weeklySchedule !== undefined) {
      const semana = aFranjas(input.weeklySchedule);
      // TR-10. Los cupos no pueden quedar por debajo de lo ya vendido en esa
      // franja: la gente ya pagó y las plazas dejarían de existir. Se mira
      // antes de escribir, para no dejar el horario a medias.
      await noBajarCuposVendidos(id, semana);
      data.weeklySchedule = semana as Prisma.InputJsonValue;
    }
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.dateOverrides !== undefined)
      data.dateOverrides = input.dateOverrides as Prisma.InputJsonValue;
    if (input.validFrom !== undefined) data.validFrom = inicioDelDia(input.validFrom);
    if (input.validUntil !== undefined)
      data.validUntil = input.validUntil === null ? null : finDelDia(input.validUntil);

    // Se comprueba antes de escribir: guardar un horario que termina antes de
    // empezar y despues avisar deja la agenda rota con el aviso dado.
    if (input.validFrom !== undefined || input.validUntil !== undefined) {
      const actual = await prisma.availability.findUnique({
        where: { id },
        select: { validFrom: true, validUntil: true },
      });
      const desde =
        input.validFrom !== undefined ? inicioDelDia(input.validFrom) : actual?.validFrom ?? null;
      const hasta =
        input.validUntil !== undefined
          ? input.validUntil === null
            ? null
            : finDelDia(input.validUntil)
          : actual?.validUntil ?? null;
      if (desde && hasta && hasta < desde) {
        throw BadRequest('La fecha final del horario no puede ser anterior a la de inicio.');
      }
    }

    return prisma.availability.update({ where: { id }, data, include: baseInclude });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.availability.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  async setPrimary(
    id: string,
    requesterCompanyId: string | null | undefined,
    { contextId, contextType }: SetPrimaryInput,
  ) {
    await assertCanManage(id, requesterCompanyId);

    if (contextType === 'location') {
      return prisma.$transaction([
        prisma.availability.updateMany({
          where: { locationId: contextId, isMain: true, deletedAt: null, NOT: { id } },
          data: { isMain: false },
        }),
        prisma.availability.update({ where: { id }, data: { isMain: true } }),
      ]);
    }
    // contextType === 'experience'
    return prisma.$transaction([
      prisma.availability.updateMany({
        where: {
          experiences: { some: { id: contextId } },
          isMain: true,
          deletedAt: null,
          NOT: { id },
        },
        data: { isMain: false },
      }),
      prisma.availability.update({ where: { id }, data: { isMain: true } }),
    ]);
  },
};
