import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type { CreateMenuInput, ListMenusQuery, UpdateMenuInput } from './menus.schemas.js';

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

async function uniqueSlug(companyId: string, base: string, ignoreId?: string) {
  const baseSlug = slugify(base) || 'menu';
  let candidate = baseSlug;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.menu.findFirst({
      where: { companyId, slug: candidate, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (!exists) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
  }
}

async function assertCanManage(menuId: string, requesterCompanyId: string | null | undefined) {
  const menu = await prisma.menu.findFirst({
    where: { id: menuId, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!menu) throw NotFound('Menu no encontrado');
  if (!requesterCompanyId || menu.companyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre este menu');
  }
  return menu;
}

/**
 * En que experiencias se usa cada menu. Va en el listado porque es lo primero
 * que se pregunta antes de tocar una carta: cambiarla afecta a todas.
 */
const conExperiencias = {
  experiences: {
    where: { deletedAt: null },
    select: { id: true, title: true },
  },
} as const;

export const menusService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateMenuInput) {
    const companyId = input.companyId ?? requesterCompanyId;
    if (!companyId) throw Forbidden('No tienes una company asociada');
    if (input.companyId && input.companyId !== requesterCompanyId) {
      throw Forbidden('No puedes crear menus en otra company');
    }

    const slug = await uniqueSlug(companyId, input.name);

    return prisma.menu.create({
      data: {
        companyId,
        name: input.name,
        slug,
        description: input.description ?? null,
        sections: (input.sections as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        isActive: input.isActive ?? true,
      },
      include: conExperiencias,
    });
  },

  async getById(
    id: string,
    requesterCompanyId: string | null | undefined,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;
    const menu = await prisma.menu.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(crossCompany ? { isActive: true } : {}),
      },
      include: conExperiencias,
    });
    if (!menu) throw NotFound('Menu no encontrado');
    if (!crossCompany) {
      // NotFound y no Forbidden: decir "existe pero no es tuyo" ya filtra que
      // existe.
      if (!requesterCompanyId || menu.companyId !== requesterCompanyId) {
        throw NotFound('Menu no encontrado');
      }
    }
    return menu;
  },

  async list(
    requesterCompanyId: string | null | undefined,
    query: ListMenusQuery,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;

    if (crossCompany) {
      return prisma.menu.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          ...(query.companyId ? { companyId: query.companyId } : {}),
        },
        orderBy: { name: 'asc' },
        include: conExperiencias,
      });
    }

    const companyId = query.companyId ?? requesterCompanyId;
    if (!companyId) return [];
    if (query.companyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a los menus de otra company');
    }
    return prisma.menu.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
      include: conExperiencias,
    });
  },

  async update(id: string, requesterCompanyId: string | null | undefined, input: UpdateMenuInput) {
    const existing = await assertCanManage(id, requesterCompanyId);

    const data: Prisma.MenuUpdateInput = {};
    if (input.name !== undefined) {
      data.name = input.name;
      data.slug = await uniqueSlug(existing.companyId, input.name, id);
    }
    if (input.description !== undefined) data.description = input.description;
    // Las secciones se reemplazan enteras: el editor manda siempre el menu
    // completo, asi que un merge parcial solo dejaria platos fantasma.
    if (input.sections !== undefined) {
      data.sections = (input.sections as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return prisma.menu.update({ where: { id }, data, include: conExperiencias });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    // El vinculo con las experiencias se deshace al borrar: si no, una carta
    // borrada seguiria saliendo en el catalogo publico de sus experiencias.
    await prisma.menu.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, experiences: { set: [] } },
    });
  },
};
