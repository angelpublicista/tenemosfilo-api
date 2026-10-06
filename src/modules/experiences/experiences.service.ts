import { Prisma, ExperienceStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { notasDeExperiencia } from '../../lib/calificacion.js';
import {
  PARA_COMPLETITUD,
  completitudDeExperiencia,
  porQueNoSePuedeVender,
} from '../../lib/completitud-de-experiencia.js';
import { reservationsService } from '../reservations/reservations.service.js';
import { noDejarAforoCorto } from '../../lib/aforo-vendido.js';
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
      blockedDates: true,
      locationId: true,
    },
  },
  // Las condiciones propias de cada sede, para que la pantalla de la
  // experiencia las enseñe sin una segunda llamada. Aqui si van las notas:
  // esto lo lee el anfitrion, no el comensal.
  locationListings: { where: { deletedAt: null } },
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
    // TR-19. Montaje y limpieza: lo que ocupa la experiencia ademas de si
    // misma. Nulo es "no aplica", no cero por defecto, porque no es lo mismo
    // decir que no hace falta montaje que no haberlo pensado todavia.
    prepTime: input.prepTime ?? null,
    cleanupTime: input.cleanupTime ?? null,
    minimumNotice: input.minimumNotice ?? null,
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
    // TR-23. Que le falta para poder venderse, calculado al leer. Asi la
    // pantalla lo dice sin tener que repetir aqui la lista de campos
    // obligatorios, que es justo donde las dos reglas se separarian.
    return { ...exp, completitud: completitudDeExperiencia(exp) };
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
      // Por nota y despues por nueva. El desempate ya no es "cuantas se han
      // vendido": una experiencia no lleva contadores de reservas ni de
      // ingresos —eso vive en Reservas y en Ingresos, y duplicarlo aqui
      // significaba mantener dos cifras que acaban discrepando.
      orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
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
    if (input.prepTime !== undefined) data.prepTime = input.prepTime ?? null;
    if (input.cleanupTime !== undefined) data.cleanupTime = input.cleanupTime ?? null;
    if (input.minimumNotice !== undefined) data.minimumNotice = input.minimumNotice ?? null;
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

    const actualizada = await prisma.experience.update({
      where: { id },
      data,
      include: fullInclude,
    });

    // TR-23. Si la edicion la deja incompleta y estaba publicada, deja de
    // venderse: una ficha sin precio en el catalogo es una venta que acaba en
    // una discusion. Vuelve a DRAFT, no se borra ni se oculta su historial.
    if (actualizada.status === 'ACTIVE') {
      const c = completitudDeExperiencia(actualizada);
      if (!c.completa) {
        return prisma.experience.update({
          where: { id },
          data: { status: 'DRAFT' },
          include: fullInclude,
        });
      }
    }

    return actualizada;
  },

  /**
   * TR-23. Publicar exige la ficha completa; guardar a medias no.
   *
   * Nadie rellena una ficha de una sentada, asi que guardar incompleta tiene
   * que poder hacerse. Lo que no puede es venderse a medias: quien compra una
   * experiencia sin precio, sin duracion o sin sitio compra una incognita.
   *
   * Pasar a INACTIVE o PAUSED no comprueba nada: dejar de vender algo nunca
   * puede estar bloqueado.
   */
  async updateStatus(
    id: string,
    requesterCompanyId: string | null | undefined,
    status: ExperienceStatus,
    opts?: { isAdmin?: boolean },
  ) {
    await assertCanManage(id, requesterCompanyId, opts);

    if (status === 'ACTIVE') {
      const ficha = await prisma.experience.findUnique({
        where: { id },
        select: PARA_COMPLETITUD,
      });
      const c = completitudDeExperiencia(ficha ?? {});
      if (!c.completa) throw BadRequest(porQueNoSePuedeVender(c), { motivo: 'INCOMPLETA', ...c });
    }

    return prisma.experience.update({ where: { id }, data: { status }, include: lightInclude });
  },

  /** TR-24. Las notas del comensal, promediadas por dimension. */
  async notas(id: string, requesterCompanyId: string | null | undefined, opts?: { isAdmin?: boolean }) {
    await assertCanManage(id, requesterCompanyId, opts);
    return notasDeExperiencia(id);
  },

  /** Que le falta a una experiencia para poder venderse (TR-23). */
  async completitud(id: string, requesterCompanyId: string | null | undefined, opts?: { isAdmin?: boolean }) {
    await assertCanManage(id, requesterCompanyId, opts);
    const ficha = await prisma.experience.findUnique({ where: { id }, select: PARA_COMPLETITUD });
    return completitudDeExperiencia(ficha ?? {});
  },

  /**
   * TR-11. Borrar una experiencia con reservas encima no puede ser silencioso.
   *
   * Hasta ahora se marcaba como borrada y las reservas se quedaban colgando
   * de una experiencia que ya no existe: la gente seguia esperando una cena
   * que nadie iba a dar, y el anfitrion se quedaba con un dinero cobrado por
   * algo que no va a ocurrir.
   *
   * Asi que se pregunta primero. Sin `cancelarReservas` se devuelve cuantas
   * hay y no se borra nada; con el, se cancelan una por una —cada una con su
   * aviso y su reembolso apuntado— y despues se borra.
   *
   * Solo cuentan las que estan por venir: las pasadas son historia y
   * cancelarlas seria reescribirla.
   */
  async softDelete(
    id: string,
    requesterCompanyId: string | null | undefined,
    opts?: { isAdmin?: boolean; cancelarReservas?: boolean },
  ) {
    const exp = await assertCanManage(id, requesterCompanyId, opts);

    const vivas = await prisma.reservation.findMany({
      where: {
        experienceId: id,
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'COMPLETED'] },
        reservationDate: { gte: new Date() },
      },
      select: { id: true, paidAmount: true },
    });

    if (vivas.length > 0 && !opts?.cancelarReservas) {
      const conPago = vivas.filter((r) => Number(r.paidAmount) > 0).length;
      throw BadRequest(
        `Esta experiencia tiene ${vivas.length} ${
          vivas.length === 1 ? 'reserva' : 'reservas'
        } por venir${conPago > 0 ? `, ${conPago} con dinero cobrado` : ''}. ` +
          'Si la eliminas se cancelarán y habrá que devolver lo cobrado. Confirma para continuar.',
        { motivo: 'TIENE_RESERVAS', reservas: vivas.length, conPago },
      );
    }

    for (const r of vivas) {
      // Por el servicio de reservas y no a mano: ahi vive el aviso al
      // comensal y el apunte del reembolso, y duplicarlo aqui acabaria en
      // dos reglas distintas para la misma cancelacion.
      // Con la empresa de la experiencia, no con la de quien llama: un ADMIN
      // puede borrar la de otro y su propio companyId no pasaria el control.
      await reservationsService.cancel(r.id, exp.companyId, {
        cancelledBy: 'host',
        reason: 'El anfitrión eliminó la experiencia',
      });
    }

    await prisma.experience.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, status: 'INACTIVE' },
    });

    return { reservasCanceladas: vivas.length };
  },

  /**
   * Las cifras del catalogo: cuantas experiencias hay y en que estado.
   *
   * Reservas e ingresos NO salen de aqui a proposito. Son de otra cosa: las
   * reservas viven en Reservas y el dinero en Ingresos, que ademas lo desglosa
   * por experiencia (TR-28). Tenerlos tambien aqui significaba mantener dos
   * cifras de lo mismo, y dos cifras de lo mismo acaban discrepando — de
   * hecho estas dos llevaban en cero desde siempre, porque nadie las escribia,
   * asi que la pantalla de experiencias prometia "0 reservas" y "$0" a quien
   * si habia vendido.
   */
  async statsByCompany(requesterCompanyId: string | null | undefined, companyId: string) {
    if (!requesterCompanyId || requesterCompanyId !== companyId) {
      throw Forbidden('No tienes acceso a las stats de otra company');
    }
    const items = await prisma.experience.findMany({
      where: { companyId, deletedAt: null },
      select: { status: true, rating: true },
    });
    const calificadas = items.filter((e) => e.rating !== null);
    const sumRating = calificadas.reduce((acc, e) => acc + (e.rating ?? 0), 0);
    return {
      total: items.length,
      active: items.filter((e) => e.status === 'ACTIVE').length,
      draft: items.filter((e) => e.status === 'DRAFT').length,
      pending: items.filter((e) => e.status === 'PENDING').length,
      paused: items.filter((e) => e.status === 'PAUSED').length,
      inactive: items.filter((e) => e.status === 'INACTIVE').length,
      // Solo las que tienen nota: promediar los ceros de las que nadie
      // califico hunde la media y no describe nada.
      averageRating: calificadas.length ? sumRating / calificadas.length : 0,
    };
  },
};
