import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../lib/errors.js';
import { normalizarDominios } from '../../lib/embed-domains.js';
import type {
  CreateCompanyInput,
  ListCompaniesQuery,
  UpdateCompanyInput,
} from './companies.schemas.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

async function uniqueSlug(base: string, ignoreId?: string): Promise<string> {
  const baseSlug = slugify(base) || 'company';
  let candidate = baseSlug;
  let i = 1;
  // Loop hasta encontrar uno libre. En la practica termina rapido.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Tambien se descartan los slugs que otra empresa tuvo antes. Un slug
    // liberado sigue vivo en enlaces compartidos: si se lo diera a otra
    // empresa, esos enlaces llevarian al negocio equivocado, que es peor
    // que no llevar a ninguno.
    const exists = await prisma.company.findFirst({
      where: {
        OR: [{ slug: candidate }, { previousSlugs: { has: candidate } }],
        NOT: ignoreId ? { id: ignoreId } : undefined,
      },
      select: { id: true },
    });
    if (!exists) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
  }
}

/**
 * Encuentra la empresa por su slug actual, uno anterior, o su id.
 *
 * El orden importa: el slug actual manda sobre el historico, porque una
 * empresa puede haber recuperado un nombre que otra tuvo.
 */
export function dondeEstaElCatalogo(slugOrId: string): Prisma.CompanyWhereInput {
  return {
    deletedAt: null,
    OR: [{ slug: slugOrId }, { previousSlugs: { has: slugOrId } }, { id: slugOrId }],
  };
}

const defaultInclude = {
  locations: { where: { deletedAt: null }, select: { id: true, name: true, isMain: true } },
} satisfies Prisma.CompanyInclude;

export const companiesService = {
  /**
   * Valida que un usuario pueda ser titular de una empresa.
   *
   * Anfitriones y revendedores: los dos operan un negocio dentro de la
   * plataforma, uno vendiendo lo suyo y otro lo de terceros, y los dos
   * necesitan una empresa a la que atribuir ventas y liquidar.
   *
   * El ADMIN queda excluido a proposito: gestiona la plataforma y opera
   * sobre empresas ajenas con el selector, pero no tiene negocio propio.
   * Un GUEST tampoco: es quien reserva.
   */
  async assertPuedeSerDuenio(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, isActive: true },
    });
    if (!user) throw NotFound('El usuario indicado no existe');
    if (!user.isActive) throw BadRequest('El usuario indicado esta inactivo');
    if (user.role !== 'HOST' && user.role !== 'RESELLER') {
      throw BadRequest(
        `El titular de una empresa debe ser Anfitrión o Revendedor (el elegido es ${user.role}).`,
      );
    }
    return user;
  },

  /**
   * Cambia el titular de una empresa.
   *
   * Hasta ahora el titular se fijaba al crearla y no habia forma de
   * moverlo: si el anfitrion vendia el negocio o dejaba la sociedad, la
   * empresa quedaba atada a una cuenta que ya no la operaba. Solo el ADMIN,
   * porque es un cambio de control sobre datos y dinero ajenos.
   */
  async transferirTitularidad(companyId: string, nuevoOwnerId: string) {
    const company = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true, ownerId: true, companyName: true },
    });
    if (!company) throw NotFound('Company no encontrada');
    if (company.ownerId === nuevoOwnerId) {
      throw BadRequest('Ese usuario ya es el titular de esta empresa');
    }

    await this.assertPuedeSerDuenio(nuevoOwnerId);

    const actualizada = await prisma.company.update({
      where: { id: companyId },
      data: { ownerId: nuevoOwnerId },
      include: defaultInclude,
    });

    // Si el nuevo titular no estaba trabajando en ninguna empresa, se le
    // deja esta como activa. Si ya tenia otra, no se le cambia por debajo:
    // para moverse entre las suyas usa el selector.
    const nuevo = await prisma.user.findUnique({
      where: { id: nuevoOwnerId },
      select: { companyId: true },
    });
    if (!nuevo?.companyId) {
      await prisma.user.update({ where: { id: nuevoOwnerId }, data: { companyId } });
    }

    return actualizada;
  },

  async create(ownerId: string, input: CreateCompanyInput) {
    const slug = await uniqueSlug(input.companyName);
    const company = await prisma.company.create({
      data: {
        ownerId,
        slug,
        companyName: input.companyName,
        businessName: input.businessName ?? null,
        description: input.description ?? null,
        companyType: input.companyType ?? null,
        companyEmail: input.companyEmail ?? null,
        companyPhone: input.companyPhone ?? null,
        logo: input.logo ?? null,
        documentType: input.documentType ?? null,
        documentNumber: input.documentNumber ?? null,
        website: input.website ?? null,
        address: input.address ?? Prisma.JsonNull,
        employeeCount: input.employeeCount ?? null,
        annualRevenue: input.annualRevenue ?? null,
        businessYears: input.businessYears ?? null,
      },
      include: defaultInclude,
    });

    // Un anfitrion puede tener varias empresas, pero User.companyId es una
    // sola: es "en cual esta trabajando ahora". Solo lo fijamos si aun no
    // tiene ninguna; si ya trabaja en otra, sobrescribirlo lo desvincularia
    // de ella en silencio. Para moverse entre las suyas usa el selector.
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { companyId: true },
    });
    if (!owner?.companyId) {
      await prisma.user.update({ where: { id: ownerId }, data: { companyId: company.id } });
    }

    return company;
  },

  async getById(id: string) {
    const company = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      include: defaultInclude,
    });
    if (!company) throw NotFound('Company no encontrada');
    return company;
  },

  /**
   * Empresas entre las que este usuario puede moverse: las que posee mas
   * aquella a la que pertenece. Un anfitrion puede tener varias, asi que
   * getByOwner (findFirst) no sirve para poblar el selector.
   */
  async listAccessible(userId: string) {
    return prisma.company.findMany({
      where: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { users: { some: { id: userId } } }],
      },
      select: { id: true, companyName: true, slug: true, ownerId: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async getByOwner(ownerId: string) {
    return prisma.company.findFirst({
      where: { ownerId, deletedAt: null },
      include: defaultInclude,
    });
  },

  /** Como getById pero devuelve null en vez de lanzar. */
  async getByIdOrNull(id: string | null | undefined) {
    if (!id) return null;
    return prisma.company.findFirst({ where: { id, deletedAt: null }, include: defaultInclude });
  },

  async getByUser(userId: string) {
    // Devuelve la company asociada al user (via companyId), no la que owns.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    });
    if (!user?.companyId) return null;
    return prisma.company.findFirst({
      where: { id: user.companyId, deletedAt: null },
      include: defaultInclude,
    });
  },

  async getBySlug(slug: string) {
    const company = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      include: defaultInclude,
    });
    if (!company) throw NotFound('Company no encontrada');
    return company;
  },

  /**
   * Listado global de todas las empresas de la plataforma. Solo ADMIN: el
   * resto de roles trabaja siempre contra su propia company.
   */
  async list(query: ListCompaniesQuery) {
    const { page, pageSize, search, deleted } = query;

    const where: Prisma.CompanyWhereInput = {
      ...(deleted === undefined
        ? {}
        : deleted
          ? { NOT: { deletedAt: null } }
          : { deletedAt: null }),
      ...(search && {
        OR: [
          { companyName: { contains: search, mode: 'insensitive' } },
          { slug: { contains: search, mode: 'insensitive' } },
          { companyEmail: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.company.findMany({
        where,
        select: {
          id: true,
          companyName: true,
          slug: true,
          companyEmail: true,
          companyPhone: true,
          companyType: true,
          deletedAt: true,
          createdAt: true,
          owner: { select: { id: true, name: true, email: true } },
          // Conteos para la tabla del panel, sin traerse las filas.
          // Filtramos deletedAt: contar los borrados logicos mostraba mas
          // experiencias de las que la empresa tiene realmente.
          _count: {
            select: {
              users: { where: { deletedAt: null } },
              experiences: { where: { deletedAt: null } },
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.company.count({ where }),
    ]);

    return { items, total };
  },

  /**
   * Dominios autorizados a insertar el catalogo en un iframe.
   *
   * Solo el dueño de la empresa (o un ADMIN): quien decide donde se puede
   * incrustar su catalogo es quien lo opera.
   */
  async setEmbedDomains(
    id: string,
    requesterId: string,
    dominios: string[],
    opts?: { isAdmin?: boolean },
  ) {
    const existing = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!existing) throw NotFound('Company no encontrada');
    if (!opts?.isAdmin && existing.ownerId !== requesterId) {
      throw Forbidden('Solo el owner puede cambiar los dominios permitidos');
    }

    return prisma.company.update({
      where: { id },
      data: { embedDomains: normalizarDominios(dominios) },
      select: { id: true, embedDomains: true },
    });
  },

  /** Soft-delete / restauracion de una empresa. Solo ADMIN. */
  async setDeleted(id: string, deleted: boolean) {
    const existing = await prisma.company.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw NotFound('Company no encontrada');

    return prisma.company.update({
      where: { id },
      data: { deletedAt: deleted ? new Date() : null },
      select: { id: true, companyName: true, deletedAt: true },
    });
  },

  async update(
    id: string,
    requesterId: string,
    input: UpdateCompanyInput,
    opts?: { isAdmin?: boolean },
  ) {
    const existing = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerId: true, companyName: true, slug: true, previousSlugs: true },
    });
    if (!existing) throw NotFound('Company no encontrada');
    // El ADMIN administra la plataforma entera, asi que no se le exige ser
    // el owner. Para el resto la regla sigue igual.
    if (!opts?.isAdmin && existing.ownerId !== requesterId) {
      throw Forbidden('Solo el owner puede actualizar');
    }

    const data: Prisma.CompanyUpdateInput = {};
    if (input.companyName !== undefined && input.companyName !== existing.companyName) {
      data.companyName = input.companyName;
      const nuevoSlug = await uniqueSlug(input.companyName, id);
      if (nuevoSlug !== existing.slug) {
        data.slug = nuevoSlug;
        // El anterior pasa al historial para que sus enlaces sigan
        // abriendo este catalogo. `set` en vez de `push` porque hay que
        // evitar duplicados si la empresa vuelve a un nombre previo.
        data.previousSlugs = {
          set: Array.from(new Set([...existing.previousSlugs, existing.slug])).filter(
            (s) => s !== nuevoSlug,
          ),
        };
      }
    }
    if (input.businessName !== undefined) data.businessName = input.businessName;
    if (input.description !== undefined) data.description = input.description;
    if (input.companyType !== undefined) data.companyType = input.companyType;
    if (input.companyEmail !== undefined) data.companyEmail = input.companyEmail;
    if (input.companyPhone !== undefined) data.companyPhone = input.companyPhone;
    if (input.logo !== undefined) data.logo = input.logo ?? null;
    if (input.documentType !== undefined) data.documentType = input.documentType;
    if (input.documentNumber !== undefined) data.documentNumber = input.documentNumber;
    if (input.website !== undefined) data.website = input.website;
    if (input.address !== undefined) data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.employeeCount !== undefined) data.employeeCount = input.employeeCount;
    if (input.annualRevenue !== undefined) data.annualRevenue = input.annualRevenue;
    if (input.businessYears !== undefined) data.businessYears = input.businessYears;
    if (input.tagline !== undefined) data.tagline = input.tagline;
    if (input.openTableRid !== undefined) data.openTableRid = input.openTableRid;
    if (input.coverType !== undefined) data.coverType = input.coverType;
    if (input.coverImages !== undefined) data.coverImages = { set: input.coverImages };
    if (input.coverVideo !== undefined) data.coverVideo = input.coverVideo;
    if (input.autoConfirmReservations !== undefined) {
      data.autoConfirmReservations = input.autoConfirmReservations;
    }
    if (input.blockWhenFull !== undefined) data.blockWhenFull = input.blockWhenFull;
    if (input.requirePayment !== undefined) data.requirePayment = input.requirePayment;

    return prisma.company.update({
      where: { id },
      data,
      include: defaultInclude,
    });
  },

  async associateUser(userId: string, companyId: string) {
    const company = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw NotFound('Company no encontrada');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true, role: true },
    });
    if (!user) throw NotFound('Usuario no encontrado');
    // Un ADMIN no pertenece a ninguna empresa: opera sobre ellas con el
    // selector "actuando como". Asociarlo le daria una empresa propia.
    if (user.role === 'ADMIN') {
      throw Forbidden(
        'Un administrador no puede asociarse a una empresa. Usa el selector de empresa activa.',
      );
    }
    if (user.companyId && user.companyId !== companyId) {
      throw Conflict('El usuario ya esta asociado a otra company');
    }
    return prisma.user.update({
      where: { id: userId },
      data: { companyId },
      select: { id: true, email: true, companyId: true },
    });
  },
};
