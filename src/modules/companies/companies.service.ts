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
    const exists = await prisma.company.findFirst({
      where: { slug: candidate, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (!exists) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
  }
}

const defaultInclude = {
  locations: { where: { deletedAt: null }, select: { id: true, name: true, isMain: true } },
} satisfies Prisma.CompanyInclude;

export const companiesService = {
  /**
   * Valida que un usuario pueda ser dueño de una empresa.
   *
   * Las empresas son de anfitriones. Un ADMIN queda excluido a proposito:
   * gestiona la plataforma y opera sobre empresas ajenas con el selector,
   * pero no tiene experiencias propias.
   */
  async assertPuedeSerDuenio(userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, role: true, isActive: true },
    });
    if (!user) throw NotFound('El usuario indicado no existe');
    if (!user.isActive) throw BadRequest('El usuario indicado esta inactivo');
    if (user.role !== 'HOST') {
      throw BadRequest(
        `El dueño de una empresa debe tener rol Anfitrión (el elegido es ${user.role}).`,
      );
    }
    return user;
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
      where: { slug, deletedAt: null },
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
      select: { id: true, ownerId: true, companyName: true, slug: true },
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
      data.slug = await uniqueSlug(input.companyName, id);
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
