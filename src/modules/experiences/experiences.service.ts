import { Prisma, ExperienceStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateExperienceInput,
  ListExperiencesQuery,
  UpdateExperienceInput,
} from './experiences.schemas.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

async function uniqueSlug(base: string, ignoreId?: string) {
  const baseSlug = slugify(base) || 'experiencia';
  let candidate = baseSlug;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.experience.findFirst({
      where: { slug: candidate, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (!exists) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
  }
}

const fullInclude = {
  company: { select: { id: true, companyName: true, companyEmail: true, companyPhone: true } },
  locations: {
    where: { deletedAt: null },
    select: { id: true, name: true, address: true, isMain: true, capacity: true },
  },
  availabilities: {
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      weeklySchedule: true,
      bufferTime: true,
      minimumNotice: true,
      blockedDates: true,
      locationId: true,
    },
  },
} satisfies Prisma.ExperienceInclude;

const lightInclude = {
  company: { select: { id: true, companyName: true } },
  locations: { where: { deletedAt: null }, select: { id: true, name: true, isMain: true } },
} satisfies Prisma.ExperienceInclude;

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const exp = await prisma.experience.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!exp) throw NotFound('Experiencia no encontrada');
  if (!requesterCompanyId || exp.companyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre esta experiencia');
  }
  return exp;
}

function buildBaseData(input: CreateExperienceInput) {
  return {
    title: input.title,
    description: input.description ?? null,
    categories: input.categories ?? [],
    duration: input.duration ?? null,
    capacity: input.capacity ?? null,
    minCapacity: input.minCapacity ?? null,
    basePrice: input.basePrice ?? null,
    currency: input.currency ?? 'COP',
    featuredImage: input.featuredImage ?? null,
    gallery: (input.gallery as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    experienceType: input.experienceType ?? 'PRESENTIAL',
    isVirtual: input.isVirtual ?? false,
    virtualPlatform: input.virtualPlatform ?? null,
    presentialLocation: input.presentialLocation ?? null,
    presentialAddress: input.presentialAddress ?? null,
    presentialCity: input.presentialCity ?? null,
    hideAddress: input.hideAddress ?? false,
    requirements: input.requirements ?? null,
    includes: (input.includes as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    addons: (input.addons as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    startDate: input.startDate ? new Date(input.startDate) : null,
    endDate: input.endDate ? new Date(input.endDate) : null,
    startTime: input.startTime ?? null,
    endTime: input.endTime ?? null,
    status: input.status ?? 'DRAFT',
    isFeatured: input.isFeatured ?? false,
  };
}

export const experiencesService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateExperienceInput) {
    const companyId = input.company ?? requesterCompanyId;
    if (!companyId) throw Forbidden('No tienes una company asociada');
    if (input.company && input.company !== requesterCompanyId) {
      throw Forbidden('No puedes crear experiencias en otra company');
    }

    const slug = await uniqueSlug(input.title);

    return prisma.experience.create({
      data: {
        ...buildBaseData(input),
        slug,
        company: { connect: { id: companyId } },
        locations:
          input.locations && input.locations.length
            ? { connect: input.locations.map((id) => ({ id })) }
            : undefined,
        availabilities:
          input.availabilities && input.availabilities.length
            ? { connect: input.availabilities.map((id) => ({ id })) }
            : undefined,
      },
      include: fullInclude,
    });
  },

  async getById(
    id: string,
    requesterCompanyId: string | null | undefined,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;
    const exp = await prisma.experience.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(crossCompany ? { status: 'ACTIVE' } : {}),
      },
      include: fullInclude,
    });
    if (!exp) throw NotFound('Experiencia no encontrada');
    // Cross-company: el reseller puede ver cualquier experiencia ACTIVE.
    // En modo normal solo el owner de la company puede leer el detalle.
    if (!crossCompany) {
      if (!requesterCompanyId || exp.companyId !== requesterCompanyId) {
        throw NotFound('Experiencia no encontrada');
      }
    }
    return exp;
  },

  async list(
    requesterCompanyId: string | null | undefined,
    query: ListExperiencesQuery,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;

    // Cross-company (reseller): puede filtrar por companyId arbitrario y solo
    // ve ACTIVE. Modo normal: cae a la propia company si no se especifica.
    const targetCompanyId = crossCompany
      ? query.companyId
      : (query.companyId ?? requesterCompanyId);

    if (!crossCompany && query.companyId && requesterCompanyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a las experiencias de otra company');
    }

    const where: Prisma.ExperienceWhereInput = {
      deletedAt: null,
      ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
      ...(crossCompany
        ? { status: 'ACTIVE' }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.category ? { categories: { has: query.category } } : {}),
      ...(query.experienceType ? { experienceType: query.experienceType } : {}),
      ...(query.isFeatured !== undefined ? { isFeatured: query.isFeatured } : {}),
      ...(query.minPrice !== undefined || query.maxPrice !== undefined
        ? {
            basePrice: {
              ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
              ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { title: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.experience.findMany({
        where,
        include: lightInclude,
        orderBy: { [query.sortBy]: query.sortOrder },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.experience.count({ where }),
    ]);

    return { items, total };
  },

  async featured(limit: number) {
    return prisma.experience.findMany({
      where: { isFeatured: true, status: 'ACTIVE', deletedAt: null },
      include: lightInclude,
      orderBy: [{ rating: 'desc' }, { totalBookings: 'desc' }],
      take: limit,
    });
  },

  async update(id: string, requesterCompanyId: string | null | undefined, input: UpdateExperienceInput) {
    await assertCanManage(id, requesterCompanyId);

    const data: Prisma.ExperienceUpdateInput = {};

    if (input.title !== undefined) {
      data.title = input.title;
      data.slug = await uniqueSlug(input.title, id);
    }
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.categories !== undefined) data.categories = input.categories;
    if (input.duration !== undefined) data.duration = input.duration;
    if (input.capacity !== undefined) data.capacity = input.capacity;
    if (input.minCapacity !== undefined) data.minCapacity = input.minCapacity;
    if (input.basePrice !== undefined) data.basePrice = input.basePrice;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.featuredImage !== undefined) data.featuredImage = input.featuredImage ?? null;
    if (input.gallery !== undefined)
      data.gallery = (input.gallery as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.experienceType !== undefined) data.experienceType = input.experienceType;
    if (input.isVirtual !== undefined) data.isVirtual = input.isVirtual;
    if (input.virtualPlatform !== undefined) data.virtualPlatform = input.virtualPlatform ?? null;
    if (input.presentialLocation !== undefined)
      data.presentialLocation = input.presentialLocation ?? null;
    if (input.presentialAddress !== undefined)
      data.presentialAddress = input.presentialAddress ?? null;
    if (input.presentialCity !== undefined) data.presentialCity = input.presentialCity ?? null;
    if (input.hideAddress !== undefined) data.hideAddress = input.hideAddress;
    if (input.requirements !== undefined) data.requirements = input.requirements ?? null;
    if (input.includes !== undefined)
      data.includes = (input.includes as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.addons !== undefined)
      data.addons = (input.addons as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.startDate !== undefined)
      data.startDate = input.startDate ? new Date(input.startDate) : null;
    if (input.endDate !== undefined)
      data.endDate = input.endDate ? new Date(input.endDate) : null;
    if (input.startTime !== undefined) data.startTime = input.startTime ?? null;
    if (input.endTime !== undefined) data.endTime = input.endTime ?? null;
    if (input.status !== undefined) data.status = input.status;
    if (input.isFeatured !== undefined) data.isFeatured = input.isFeatured;

    if (input.locations !== undefined) {
      data.locations = { set: input.locations.map((id) => ({ id })) };
    }
    if (input.availabilities !== undefined) {
      data.availabilities = { set: input.availabilities.map((id) => ({ id })) };
    }

    return prisma.experience.update({ where: { id }, data, include: fullInclude });
  },

  async updateStatus(id: string, requesterCompanyId: string | null | undefined, status: ExperienceStatus) {
    await assertCanManage(id, requesterCompanyId);
    return prisma.experience.update({ where: { id }, data: { status }, include: lightInclude });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.experience.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, status: 'INACTIVE' },
    });
  },

  async statsByCompany(requesterCompanyId: string | null | undefined, companyId: string) {
    if (!requesterCompanyId || requesterCompanyId !== companyId) {
      throw Forbidden('No tienes acceso a las stats de otra company');
    }
    const items = await prisma.experience.findMany({
      where: { companyId, deletedAt: null },
      select: { status: true, totalBookings: true, totalRevenue: true, rating: true },
    });
    const sumRevenue = items.reduce((acc, e) => acc + Number(e.totalRevenue), 0);
    const sumRating = items.reduce((acc, e) => acc + (e.rating ?? 0), 0);
    return {
      total: items.length,
      active: items.filter((e) => e.status === 'ACTIVE').length,
      draft: items.filter((e) => e.status === 'DRAFT').length,
      pending: items.filter((e) => e.status === 'PENDING').length,
      paused: items.filter((e) => e.status === 'PAUSED').length,
      inactive: items.filter((e) => e.status === 'INACTIVE').length,
      totalBookings: items.reduce((acc, e) => acc + e.totalBookings, 0),
      totalRevenue: sumRevenue,
      averageRating: items.length ? sumRating / items.length : 0,
    };
  },
};
