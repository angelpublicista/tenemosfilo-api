import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateLocationInput,
  ListLocationsQuery,
  UpdateLocationInput,
} from './locations.schemas.js';

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
  const baseSlug = slugify(base) || 'sede';
  let candidate = baseSlug;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const exists = await prisma.location.findFirst({
      where: { companyId, slug: candidate, NOT: ignoreId ? { id: ignoreId } : undefined },
      select: { id: true },
    });
    if (!exists) return candidate;
    i += 1;
    candidate = `${baseSlug}-${i}`;
  }
}

async function assertCanManage(locationId: string, requesterCompanyId: string | null | undefined) {
  const loc = await prisma.location.findFirst({
    where: { id: locationId, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!loc) throw NotFound('Sede no encontrada');
  if (!requesterCompanyId || loc.companyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre esta sede');
  }
  return loc;
}

export const locationsService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateLocationInput) {
    const companyId = input.companyId ?? requesterCompanyId;
    if (!companyId) throw Forbidden('No tienes una company asociada');
    if (input.companyId && input.companyId !== requesterCompanyId) {
      throw Forbidden('No puedes crear sedes en otra company');
    }

    const slug = await uniqueSlug(companyId, input.name);

    return prisma.location.create({
      data: {
        companyId,
        name: input.name,
        slug,
        isMain: input.isMain ?? false,
        description: input.description ?? null,
        address: (input.address as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        contactInfo: (input.contactInfo as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        capacity: (input.capacity as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        isActive: input.isActive ?? true,
      },
    });
  },

  async getById(id: string, requesterCompanyId: string | null | undefined) {
    const loc = await prisma.location.findFirst({ where: { id, deletedAt: null } });
    if (!loc) throw NotFound('Sede no encontrada');
    if (!requesterCompanyId || loc.companyId !== requesterCompanyId) {
      throw NotFound('Sede no encontrada');
    }
    return loc;
  },

  async list(requesterCompanyId: string | null | undefined, query: ListLocationsQuery) {
    const companyId = query.companyId ?? requesterCompanyId;
    if (!companyId) return [];
    if (query.companyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a las sedes de otra company');
    }
    return prisma.location.findMany({
      where: {
        companyId,
        deletedAt: null,
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    });
  },

  async update(id: string, requesterCompanyId: string | null | undefined, input: UpdateLocationInput) {
    const existing = await assertCanManage(id, requesterCompanyId);

    const data: Prisma.LocationUpdateInput = {};
    if (input.name !== undefined) {
      data.name = input.name;
      data.slug = await uniqueSlug(existing.companyId, input.name, id);
    }
    if (input.isMain !== undefined) data.isMain = input.isMain;
    if (input.description !== undefined) data.description = input.description;
    if (input.address !== undefined)
      data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.contactInfo !== undefined)
      data.contactInfo = (input.contactInfo as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.capacity !== undefined)
      data.capacity = (input.capacity as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    return prisma.location.update({ where: { id }, data });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.location.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  async setMain(id: string, requesterCompanyId: string | null | undefined) {
    const loc = await assertCanManage(id, requesterCompanyId);
    return prisma.$transaction([
      prisma.location.updateMany({
        where: { companyId: loc.companyId, isMain: true, deletedAt: null, NOT: { id } },
        data: { isMain: false },
      }),
      prisma.location.update({ where: { id }, data: { isMain: true } }),
    ]);
  },
};
