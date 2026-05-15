import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateCrmCompanyInput,
  ListCrmCompaniesQuery,
  UpdateCrmCompanyInput,
} from './crm-companies.schemas.js';

const fullInclude = {
  hostCompany: { select: { id: true, companyName: true } },
  assignedTo: { select: { id: true, name: true } },
} satisfies Prisma.CrmCompanyInclude;

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const c = await prisma.crmCompany.findUnique({
    where: { id },
    select: { id: true, hostCompanyId: true },
  });
  if (!c) throw NotFound('Empresa CRM no encontrada');
  if (!requesterCompanyId || c.hostCompanyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre esta empresa CRM');
  }
  return c;
}

export const crmCompaniesService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateCrmCompanyInput) {
    const hostCompanyId = input.hostCompany ?? requesterCompanyId;
    if (!hostCompanyId) throw Forbidden('No tienes una company asociada');
    if (input.hostCompany && input.hostCompany !== requesterCompanyId) {
      throw Forbidden('No puedes crear empresas en otra company');
    }

    return prisma.crmCompany.create({
      data: {
        hostCompany: { connect: { id: hostCompanyId } },
        companyName: input.companyName,
        businessName: input.businessName ?? null,
        companyType: input.companyType ?? null,
        industry: input.industry ?? null,
        description: input.description ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        website: input.website ?? null,
        documentType: input.documentType ?? null,
        documentNumber: input.documentNumber ?? null,
        address: (input.address as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        employeeCount: input.employeeCount ?? null,
        annualRevenue: input.annualRevenue ?? null,
        logo: input.logo ?? null,
        status: input.status ?? null,
        source: input.source ?? null,
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        socialMedia: (input.socialMedia as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        ...(input.assignedTo ? { assignedTo: { connect: { id: input.assignedTo } } } : {}),
        lastContactDate: input.lastContactDate ? new Date(input.lastContactDate) : null,
        nextFollowUp: input.nextFollowUp ? new Date(input.nextFollowUp) : null,
        isActive: input.isActive ?? true,
      },
      include: fullInclude,
    });
  },

  async getById(id: string, requesterCompanyId: string | null | undefined) {
    const c = await prisma.crmCompany.findFirst({
      where: { id, deletedAt: null },
      include: fullInclude,
    });
    if (!c) throw NotFound('Empresa CRM no encontrada');
    if (!requesterCompanyId || c.hostCompanyId !== requesterCompanyId) {
      throw NotFound('Empresa CRM no encontrada');
    }
    return c;
  },

  async list(requesterCompanyId: string | null | undefined, query: ListCrmCompaniesQuery) {
    const targetHostId = query.hostCompanyId ?? requesterCompanyId;
    if (
      query.hostCompanyId &&
      requesterCompanyId &&
      query.hostCompanyId !== requesterCompanyId
    ) {
      throw Forbidden('No tienes acceso a empresas CRM de otra company');
    }
    if (!targetHostId) return [];

    const where: Prisma.CrmCompanyWhereInput = {
      deletedAt: null,
      hostCompanyId: targetHostId,
      ...(query.companyType ? { companyType: query.companyType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.industry ? { industry: query.industry } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.assignedTo ? { assignedToId: query.assignedTo } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { companyName: { contains: query.search, mode: 'insensitive' } },
              { businessName: { contains: query.search, mode: 'insensitive' } },
              { email: { contains: query.search, mode: 'insensitive' } },
              { phone: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return prisma.crmCompany.findMany({
      where,
      include: fullInclude,
      orderBy: { [query.sortBy]: query.sortOrder },
      take: query.limit,
    });
  },

  async update(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: UpdateCrmCompanyInput,
  ) {
    await assertCanManage(id, requesterCompanyId);

    const data: Prisma.CrmCompanyUpdateInput = {};
    if (input.companyName !== undefined) data.companyName = input.companyName;
    if (input.businessName !== undefined) data.businessName = input.businessName;
    if (input.companyType !== undefined) data.companyType = input.companyType;
    if (input.industry !== undefined) data.industry = input.industry;
    if (input.description !== undefined) data.description = input.description;
    if (input.email !== undefined) data.email = input.email;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.website !== undefined) data.website = input.website;
    if (input.documentType !== undefined) data.documentType = input.documentType;
    if (input.documentNumber !== undefined) data.documentNumber = input.documentNumber;
    if (input.address !== undefined)
      data.address = (input.address as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.employeeCount !== undefined) data.employeeCount = input.employeeCount;
    if (input.annualRevenue !== undefined) data.annualRevenue = input.annualRevenue;
    if (input.logo !== undefined) data.logo = input.logo;
    if (input.status !== undefined) data.status = input.status;
    if (input.source !== undefined) data.source = input.source;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.socialMedia !== undefined)
      data.socialMedia = (input.socialMedia as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.lastContactDate !== undefined)
      data.lastContactDate = input.lastContactDate ? new Date(input.lastContactDate) : null;
    if (input.nextFollowUp !== undefined)
      data.nextFollowUp = input.nextFollowUp ? new Date(input.nextFollowUp) : null;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.assignedTo !== undefined) {
      data.assignedTo = input.assignedTo
        ? { connect: { id: input.assignedTo } }
        : { disconnect: true };
    }

    return prisma.crmCompany.update({ where: { id }, data, include: fullInclude });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.crmCompany.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },

  async restore(id: string, requesterCompanyId: string | null | undefined) {
    const c = await prisma.crmCompany.findUnique({
      where: { id },
      select: { id: true, hostCompanyId: true },
    });
    if (!c) throw NotFound('Empresa CRM no encontrada');
    if (!requesterCompanyId || c.hostCompanyId !== requesterCompanyId) {
      throw Forbidden('No tienes permiso sobre esta empresa CRM');
    }
    return prisma.crmCompany.update({
      where: { id },
      data: { deletedAt: null, isActive: true },
      include: fullInclude,
    });
  },
};
