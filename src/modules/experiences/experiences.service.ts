import { Prisma, ExperienceStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
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
    select: { id: true, name: true, address: true, isMain: true, maxCapacity: true },
  },
  menus: {
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, description: true, sections: true },
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
  menus: { where: { deletedAt: null, isActive: true }, select: { id: true, name: true } },
} satisfies Prisma.ExperienceInclude;

async function assertCanManage(
  id: string,
  requesterCompanyId: string | null | undefined,
  opts?: { isAdmin?: boolean },
) {
  const exp = await prisma.experience.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!exp) throw NotFound('Experiencia no encontrada');
  // El ADMIN gestiona experiencias de cualquier empresa; no tiene companyId
  // propio, asi que la comparacion de abajo siempre lo dejaria fuera.
  if (opts?.isAdmin) return exp;
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
    presentialState: input.presentialState ?? null,
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
 */
async function noDejarAforoCorto(experienceId: string, nuevoAforo: number): Promise<void> {
  if (nuevoAforo <= 0) return;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const porDia = await prisma.reservation.groupBy({
    by: ['reservationDate'],
    where: {
      experienceId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      reservationDate: { gte: hoy },
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
      `No puedes bajar el aforo a ${nuevoAforo}: el ${d}/${m}/${a} ya tienes ${peorCuenta} personas reservadas. ` +
        'Cancela o reagenda esas reservas primero.',
    );
  }
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
        menus:
          input.menus && input.menus.length
            ? { connect: input.menus.map((id) => ({ id })) }
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

  async update(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: UpdateExperienceInput,
    opts?: { isAdmin?: boolean },
  ) {
    await assertCanManage(id, requesterCompanyId, opts);

    const data: Prisma.ExperienceUpdateInput = {};

    if (input.title !== undefined) {
      data.title = input.title;
      data.slug = await uniqueSlug(input.title, id);
    }
    if (input.description !== undefined) data.description = input.description ?? null;
    if (input.categories !== undefined) data.categories = input.categories;
    if (input.duration !== undefined) data.duration = input.duration;
    if (input.capacity !== undefined) {
      await noDejarAforoCorto(id, input.capacity);
      data.capacity = input.capacity;
    }
    if (input.minCapacity !== undefined) data.minCapacity = input.minCapacity;
    if (input.basePrice !== undefined) data.basePrice = input.basePrice;

    // Comisiones: null explicito borra el valor propio y vuelve a heredar
    // el de la plataforma. El controller ya filtro estos campos si quien
    // llama no es ADMIN.
    if (input.filoCommissionType !== undefined) data.filoCommissionType = input.filoCommissionType;
    if (input.filoCommissionValue !== undefined)
      data.filoCommissionValue = input.filoCommissionValue;
    if (input.resellerCommissionType !== undefined)
      data.resellerCommissionType = input.resellerCommissionType;
    if (input.resellerCommissionValue !== undefined)
      data.resellerCommissionValue = input.resellerCommissionValue;
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
    if (input.presentialState !== undefined) data.presentialState = input.presentialState ?? null;
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
    if (input.menus !== undefined) {
      data.menus = { set: input.menus.map((id) => ({ id })) };
    }
    if (input.availabilities !== undefined) {
      data.availabilities = { set: input.availabilities.map((id) => ({ id })) };
    }

    return prisma.experience.update({ where: { id }, data, include: fullInclude });
  },

  async updateStatus(
    id: string,
    requesterCompanyId: string | null | undefined,
    status: ExperienceStatus,
    opts?: { isAdmin?: boolean },
  ) {
    await assertCanManage(id, requesterCompanyId, opts);
    return prisma.experience.update({ where: { id }, data: { status }, include: lightInclude });
  },

  async softDelete(
    id: string,
    requesterCompanyId: string | null | undefined,
    opts?: { isAdmin?: boolean },
  ) {
    await assertCanManage(id, requesterCompanyId, opts);
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
