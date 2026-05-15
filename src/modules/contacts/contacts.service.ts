import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateContactInput,
  ListContactsQuery,
  UpdateContactInput,
} from './contacts.schemas.js';

const fullInclude = {
  hostCompany: { select: { id: true, companyName: true } },
  crmCompany: { select: { id: true, companyName: true } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ContactInclude;

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const c = await prisma.contact.findUnique({
    where: { id },
    select: { id: true, hostCompanyId: true },
  });
  if (!c) throw NotFound('Contacto no encontrado');
  if (!requesterCompanyId || c.hostCompanyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre este contacto');
  }
  return c;
}

export const contactsService = {
  async create(
    requesterId: string,
    requesterCompanyId: string | null | undefined,
    input: CreateContactInput,
  ) {
    const hostCompanyId = input.hostCompany ?? requesterCompanyId;
    if (!hostCompanyId) throw Forbidden('No tienes una company asociada');
    if (input.hostCompany && input.hostCompany !== requesterCompanyId) {
      throw Forbidden('No puedes crear contactos en otra company');
    }
    const createdById = input.createdBy ?? requesterId;

    return prisma.contact.create({
      data: {
        hostCompany: { connect: { id: hostCompanyId } },
        firstName: input.firstName,
        lastName: input.lastName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        mobile: input.mobile ?? null,
        jobTitle: input.jobTitle ?? null,
        department: input.department ?? null,
        ...(input.company ? { crmCompany: { connect: { id: input.company } } } : {}),
        contactType: input.contactType ?? null,
        status: input.status ?? 'ACTIVE',
        source: input.source ?? null,
        address: (input.address as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        avatar: input.avatar ?? null,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        socialMedia: (input.socialMedia as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        ...(input.assignedTo ? { assignedTo: { connect: { id: input.assignedTo } } } : {}),
        createdBy: { connect: { id: createdById } },
        lastContactDate: input.lastContactDate ? new Date(input.lastContactDate) : null,
        nextFollowUp: input.nextFollowUp ? new Date(input.nextFollowUp) : null,
        isActive: input.isActive ?? true,
      },
      include: fullInclude,
    });
  },

  async getById(id: string, requesterCompanyId: string | null | undefined) {
    const c = await prisma.contact.findFirst({
      where: { id, deletedAt: null },
      include: fullInclude,
    });
    if (!c) throw NotFound('Contacto no encontrado');
    if (!requesterCompanyId || c.hostCompanyId !== requesterCompanyId) {
      throw NotFound('Contacto no encontrado');
    }
    return c;
  },

  async list(requesterCompanyId: string | null | undefined, query: ListContactsQuery) {
    const targetHostId = query.hostCompanyId ?? requesterCompanyId;
    if (
      query.hostCompanyId &&
      requesterCompanyId &&
      query.hostCompanyId !== requesterCompanyId
    ) {
      throw Forbidden('No tienes acceso a contactos de otra company');
    }
    if (!targetHostId) return [];

    const where: Prisma.ContactWhereInput = {
      deletedAt: null,
      hostCompanyId: targetHostId,
      ...(query.contactType ? { contactType: query.contactType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.company ? { crmCompanyId: query.company } : {}),
      ...(query.assignedTo ? { assignedToId: query.assignedTo } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { firstName: { contains: query.search, mode: 'insensitive' } },
              { lastName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { mobile: { contains: query.search, mode: 'insensitive' } },
              { jobTitle: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return prisma.contact.findMany({
      where,
      include: fullInclude,
      orderBy: { [query.sortBy]: query.sortOrder },
      take: query.limit,
    });
  },

  async update(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: UpdateContactInput,
  ) {
    await assertCanManage(id, requesterCompanyId);

    const data: Prisma.ContactUpdateInput = {};
    if (input.firstName !== undefined) data.firstName = input.firstName;
    if (input.lastName !== undefined) data.lastName = input.lastName;
    if (input.email !== undefined) data.email = input.email;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.mobile !== undefined) data.mobile = input.mobile;
    if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
    if (input.department !== undefined) data.department = input.department;
    if (input.contactType !== undefined) data.contactType = input.contactType;
    if (input.status !== undefined) data.status = input.status;
    if (input.source !== undefined) data.source = input.source;
    if (input.address !== undefined)
      data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.avatar !== undefined) data.avatar = input.avatar;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.socialMedia !== undefined)
      data.socialMedia = (input.socialMedia as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.lastContactDate !== undefined)
      data.lastContactDate = input.lastContactDate ? new Date(input.lastContactDate) : null;
    if (input.nextFollowUp !== undefined)
      data.nextFollowUp = input.nextFollowUp ? new Date(input.nextFollowUp) : null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.company !== undefined) {
      data.crmCompany = input.company ? { connect: { id: input.company } } : { disconnect: true };
    }
    if (input.assignedTo !== undefined) {
      data.assignedTo = input.assignedTo
        ? { connect: { id: input.assignedTo } }
        : { disconnect: true };
    }

    return prisma.contact.update({ where: { id }, data, include: fullInclude });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.contact.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  async restore(id: string, requesterCompanyId: string | null | undefined) {
    const c = await prisma.contact.findUnique({
      where: { id },
      select: { id: true, hostCompanyId: true },
    });
    if (!c) throw NotFound('Contacto no encontrado');
    if (!requesterCompanyId || c.hostCompanyId !== requesterCompanyId) {
      throw Forbidden('No tienes permiso sobre este contacto');
    }
    return prisma.contact.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
      include: fullInclude,
    });
  },
};
