import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
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

async function experienceCompanyId(experienceId: string): Promise<string | null> {
  const exp = await prisma.experience.findFirst({
    where: { id: experienceId, deletedAt: null },
    select: { companyId: true },
  });
  return exp?.companyId ?? null;
}

async function blockedDatesToStrings(input: CreateAvailabilityInput['blockedDates']): Promise<string[]> {
  if (!input) return [];
  return input.map((d) => (typeof d === 'string' ? d : d.date));
}

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const av = await prisma.availability.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      locationId: true,
      location: { select: { companyId: true } },
      experiences: { select: { companyId: true } },
    },
  });
  if (!av) throw NotFound('Disponibilidad no encontrada');
  if (!requesterCompanyId) throw Forbidden('No tienes una company asociada');
  const allCompanyIds = new Set<string>();
  if (av.location?.companyId) allCompanyIds.add(av.location.companyId);
  for (const e of av.experiences) allCompanyIds.add(e.companyId);
  if (allCompanyIds.size > 0 && !allCompanyIds.has(requesterCompanyId)) {
    throw Forbidden('No tienes permiso sobre esta disponibilidad');
  }
  return av;
}

export const availabilitiesService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateAvailabilityInput) {
    if (!requesterCompanyId) throw Forbidden('No tienes una company asociada');

    if (input.location) {
      const cid = await locationCompanyId(input.location);
      if (!cid) throw NotFound('Location no encontrada');
      if (cid !== requesterCompanyId) throw Forbidden('La location no pertenece a tu company');
    }
    if (input.experience) {
      const cid = await experienceCompanyId(input.experience);
      if (!cid) throw NotFound('Experiencia no encontrada');
      if (cid !== requesterCompanyId) throw Forbidden('La experiencia no pertenece a tu company');
    }

    return prisma.availability.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        weeklySchedule: input.weeklySchedule as Prisma.InputJsonValue,
        bufferTime: input.bufferTime ?? 0,
        minimumNotice: input.minimumNotice ?? 24,
        blockedDates: await blockedDatesToStrings(input.blockedDates),
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
      ...(query.companyId
        ? {
            OR: [
              { location: { companyId: query.companyId } },
              { experiences: { some: { companyId: query.companyId } } },
            ],
          }
        : crossCompany
          ? {}
          : requesterCompanyId
            ? {
                OR: [
                  { location: { companyId: requesterCompanyId } },
                  { experiences: { some: { companyId: requesterCompanyId } } },
                ],
              }
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
    if (input.weeklySchedule !== undefined)
      data.weeklySchedule = input.weeklySchedule as Prisma.InputJsonValue;
    if (input.bufferTime !== undefined) data.bufferTime = input.bufferTime;
    if (input.minimumNotice !== undefined) data.minimumNotice = input.minimumNotice;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.blockedDates !== undefined)
      data.blockedDates = await blockedDatesToStrings(input.blockedDates);

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
