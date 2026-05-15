import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Conflict, Forbidden, NotFound } from '../../lib/errors.js';
import type { CreateCompanyInput, UpdateCompanyInput } from './companies.schemas.js';

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

    // Asociar el owner como user de la company
    await prisma.user.update({
      where: { id: ownerId },
      data: { companyId: company.id },
    });

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

  async getByOwner(ownerId: string) {
    return prisma.company.findFirst({
      where: { ownerId, deletedAt: null },
      include: defaultInclude,
    });
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

  async update(id: string, requesterId: string, input: UpdateCompanyInput) {
    const existing = await prisma.company.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, ownerId: true, companyName: true, slug: true },
    });
    if (!existing) throw NotFound('Company no encontrada');
    if (existing.ownerId !== requesterId) throw Forbidden('Solo el owner puede actualizar');

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

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } });
    if (!user) throw NotFound('Usuario no encontrado');
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
